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
writing over the static data below the stack; no measured cost). It
keeps the wasm tail calls, so it needs an engine that has them (Safari
18.2, Firefox 121, Chrome 112 and later): without them
(`ROCQ_WEB_NO_TAIL_CALLS=1`, `--no-tail-calls`, which makes them ordinary
calls) coq-lsp overflows the stack of Chromium's worker on the first
example, `--cps-stack` notwithstanding (`rocq_web.js` compiles it under
node).

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

The app keeps the files (the browser's local storage), in folders; the
page writes them in the worker's file system too (`web/rocq-web-fs.js`,
messages answered between two of Rocq's steps): `Load` reads them, and the
files Rocq writes there (`Extraction`) are listed, shown and downloaded.
`/workspace` is the worker's current directory.

### Workspaces

A folder can be a workspace: a Rocq project of its own, its files the
modules `NAME.*` (`NAME` the folder's name), as its project file says. That
file is generated (`-R . NAME`) unless the user writes one in the folder
(`_RocqProject`, or `_CoqProject`: menu "Write its _RocqProject"); the
files outside the workspaces are the modules `Workspace.DIR.NAME`, or what
a `_RocqProject` at the root says. A folder imported (picked, dropped, or
opened on disk) or an example becomes a workspace; workspaces do not
contain one another.

A workspace sees the others, and the root's files see them all: their
modules are required by their qualified names (`From Lib Require Base`,
`Require Lib.Base`), the generated project files adding a `-Q` for each
directory of the others' load paths (relative to the folder,
`-Q ../Lib Lib`). The root's adds them with `-R`: coq-lsp adds a project's
`-Q` before its `-R`, and the root's `-R . Workspace`, which covers the
workspaces' folders, would bind them last (Rocq binds a folder to one
name; the warning of a folder bound again is off). A project file the
user writes says itself what it sees (menu "Write its _RocqProject"
starts from the generated one, with these lines). The root's files are in
no workspace's load path.

A library of Rocq files is added as a workspace (Files panel, "Add a
library"; `app/src/lib/library.ts`): from a GitHub repository, its files
fetched from jsDelivr (`data.jsdelivr.com` lists them,
`cdn.jsdelivr.net/gh/OWNER/REPO@REF/` serves them; GitHub's archives,
`codeload.github.com`, are not for other sites: CORS), from the URL of an
archive whose server allows it, or from an archive on disk (zip, tar,
tar.gz: `app/src/lib/archive.ts`). Its project file at its top is kept,
with the `.v` of the directories it names. Its OCaml plugins
(`Declare ML Module`) cannot be built in the browser: only the build's
packages have theirs, which the app tells.

Each workspace is a workspace folder of coq-lsp (`/workspace/DIR`, the
root `/workspace` last: coq-lsp takes the first containing a file), the
generated project files written in the worker. A project file that
changes, or a workspace added or removed, is read again without
restarting Rocq (`workspace/didChangeWorkspaceFolders`: the workspace
removed and added; all of them for the root's, as coq-lsp searches them
from the last added), and the document open again.

The code: `app/src/lib/` (storage, workspaces, the LSP client, the
dependencies' compilation...), `app/src/hooks/` (the files as React state,
the Rocq session, the active document, navigation, queries),
`app/src/components/` (the views).

Before checking a file, the app compiles the files it requires, in
order: opened in coq-lsp, `coq/saveVo` writes their `.vo` (patched to
refuse a document with errors, and to name the module from the
document's load path, not from that of the state another document left:
a workspace renamed by its project file compiled under its former name),
closed; then `coq/workspace_update` makes
coq-lsp check again with them (patched so that documents opened later do
not reuse what `Require` loaded before). Switching files closes the
previous one. coq-lsp's caches are kept, so going back to a file is
quick. `coq/trimCaches` (two `Gc.full_major`, seconds before the worker
checks the next file) is sent only when the workspaces are read again:
the cached states have the former load paths.

The `.vo` compiled are kept in the browser (IndexedDB, the most recently
used up to 256 MB), by a SHA-256 of what they were compiled from: the
version of the worker's libraries (the hash of their files, which the
worker sends when it starts), the file's module, its workspace's project
file (or its name, for the generated one), its text, and the `.vo` of the
files it requires. The next load of the page writes them in the worker
instead of compiling the files again.

Checking up to the cursor is coq-lsp's `check_only_on_request`: a
document is checked up to the points of requests, the goals' at the
cursor on Alt+Enter, Alt+N, Alt+P (the sentences are found by the page,
`app/src/lib/sentences.ts`).

The goals are Rocq's documents (`pp_format` "Pp"), laid out for the
panel's width by the page (`app/src/components/goals/Pp.tsx`, Format's boxes and breaks);
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
