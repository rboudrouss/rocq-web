# Design

Rocq in the browser, compiled to WebAssembly by
[ocaml-emcc](https://github.com/rboudrouss/ocaml-emcc) (compiled mode:
c_of_ocaml + emcc), with its plugins and libraries (mathcomp...) fetched
when a document needs them.

## Two builds

| | full | compat |
|-|------|--------|
| target | wasm64 (63-bit OCaml integers) | the same code, its memory64 lowered to a 32-bit memory |
| deep recursion | `--jspi` | `--cps-stack` |
| plugins | wasm side modules, fetched on `Declare ML Module` (`--dynlink`) | the same, lowered and with `--cps-stack` |
| browsers | memory64 and JSPI: Chrome/Edge 137+ (Firefox once it ships JSPI) | all |
| memory | up to 16 GB | up to 4 GB |
| `.vo` files | the switch's | the same |

The page picks the build at startup: `WebAssembly.validate` on a module
with a 64-bit memory, and `WebAssembly.Suspending` for JSPI. Either missing
means compat (`?build=compat` or `?build=full` in the URL forces one).

### Why compat is 64-bit code

A wasm32 Rocq (31-bit OCaml integers) would need its own libraries: Rocq
picks its primitive integers with the word size (`uint63_31.ml`, a boxed
`Int64`, or `uint63_63.ml`, an immediate), so marshalled terms differ, and
a 32-bit OCaml cannot read the 63-bit integers of a 64-bit `.vo`. Instead
compat is the code of full (compiled for wasm64, objects shared), linked
with emscripten's `MEMORY64=2`: binaryen's `--memory64-lowering` turns its
64-bit addresses into 32-bit ones of a 32-bit memory, the code computing
with 64-bit pointers and integers as before. It runs in engines without
memory64, reads the same `.vo`, and its plugins are the same side modules
lowered the same way (`EMCC_CFLAGS=-sMEMORY64=2` for `ocaml-emcc plugin`,
emscripten's dynamic linker supporting it). Without JSPI, deep recursions
go on in CPS on the heap (`--cps-stack`, with `--dynlink` since ocaml-emcc
09ee06a). They still grow emscripten's C stack (over-applications, C
functions), which is then the limit: 64 MB, checked
(`-sSTACK_OVERFLOW_CHECK=2`: an overflow aborts the worker instead of
writing over the static data below the stack; no measured cost).

CPS does not cover callbacks from C or JavaScript, so the worker's loop
stays in `main` there too, and, without JSPI to suspend it while it waits
for a message, it blocks (`Atomics.wait`): the page then sends its
messages, and its operations on the worker's files, through memory shared
with the worker (`app/src/channel.ts`, read by `web/rocq-web-io.js`)
instead of `postMessage`, which a blocked worker never receives. That
needs a cross-origin isolated page, as the interrupts do.

## Plugins

The plugins Corelib's prelude loads (ltac, number_string_notation, tauto,
cc, firstorder, with coq-lsp's serlib for each) are linked in the worker:
it starts faster than loading them. The others are side modules. Rocq
resolves `Declare ML Module "pkg"` with findlib and `Dynlink`. The
worker installs its own loader with `Mltop.set_top` (no patch to Rocq):
package `pkg` is the side module `plugins/pkg.wasm`, made by
`ocaml-emcc plugin` from the package's `.cma` against this exact build of
the program (interfaces are checked), so the plugin set is versioned with
the program. A plugin may use the libraries of the plugins loaded before
it (elpi, then rocq-elpi).

Opam installs the plugins built by coq_makefile native only (it builds a
`.cma` only with `make byte`): `scripts/byte-plugins.sh` compiles their
bytecode from the package's sources.

## Packages

A package (opam package, e.g. rocq-mathcomp-ssreflect) is, per build:
`.vo`/`.glob` files, `.v` sources (go to definition), plugins, and an entry
of a JSON manifest (logical paths, dependencies). In the worker the files
are lazy entries of emscripten's file system, fetched with a synchronous
request on first read (allowed in a worker), then cached. The files Rocq
reads when it starts (the prelude's `.vo`, findlib's META files) come in
one request instead, `boot.bin`, fetched while the worker's WebAssembly
compiles (`web/boot-files.txt`, recorded by `tests/startup.mjs --record`).

The app's package browser lists the opam packages with Rocq libraries
(`packages.json`, from the switch's metadata) and their modules.

## The user's files

The app keeps several files (the browser's local storage), in folders;
each is the module `Workspace.DIR.NAME` (`/workspace` in the worker, its
`_RocqProject` binds it), or what the workspace's own `_RocqProject`
says. The page writes the files in the worker's file system too
(`web/rocq-web-fs.js`, messages answered between two of Rocq's steps):
`Load` reads them, `_RocqProject` is read when Rocq starts, and the files
Rocq writes there (`Extraction`) are listed, shown and downloaded.
`/workspace` is the worker's current directory.

Before checking a file, the app compiles the files it requires, in
order: opened in coq-lsp, `coq/saveVo` writes their `.vo` (patched to
refuse a document with errors), closed; then `coq/workspace_update` makes
coq-lsp check again with them (patched so that documents opened later do
not reuse what `Require` loaded before). Switching files closes the
previous one and trims coq-lsp's caches (`coq/trimCaches`).

Checking up to the cursor is coq-lsp's `check_only_on_request`: a
document is checked up to the points of requests, the goals' at the
cursor on Alt+Enter, Alt+N, Alt+P (the sentences are found by the page,
`app/src/sentences.ts`).

The goals are Rocq's documents (`pp_format` "Pp"), laid out for the
panel's width by the page (`app/src/pp.tsx`, Format's boxes and breaks);
the goals before the sentence (`mode` "Prev" at its start) give what it
changed, the words of the goals' longest common subsequence not
highlighted.

The search of the libraries is an index of the declarations of their
sources (`search.tsv`, 129,000 declarations, 2 MB with brotli), written
with the assets and downloaded on the first search.

## Not supported

- `native_compute` (it runs ocamlopt and loads the result); `vm_compute`
  works, Rocq's VM is C.
- Plugins that run external programs (coq-hammer's provers) or compile
  OCaml at run time (QuickChick).

## Interrupts

The worker cannot receive messages while Rocq computes. The page shares a
flag with it (a SharedArrayBuffer: the page must be cross-origin
isolated), set on each edit; a minor GC hook of the worker
(worker/plugins/interrupt.c) reads it and sets `Control.interrupt`, which
Rocq's next `Control.check_for_interrupt` turns into `Sys.Break`; coq-lsp
then handles the edit and checks again from it.

Rocq's reductions (`Eval compute`, unification) never check: an interrupt
still pending after half a second is raised by a Memprof callback (at an
allocation) while coq-lsp runs a command, as native coq-lsp does with
memprof-limits (on OCaml 4.14 only).

`Timeout` is Rocq's `Control.timeout` replaced (`Control.set_timeout`):
Rocq's own uses `setitimer` and `SIGALRM`, which WebAssembly never
delivers. The same Memprof callback raises `Control.Timeout` once a
deadline passed.

## Open questions

- Whether `.vo` files built by a native 64-bit Rocq load in the full
  build: they do (Corelib, Stdlib, mathcomp).
