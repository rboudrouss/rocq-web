# Design

Rocq and coq-lsp are compiled to WebAssembly by
[ocaml-emcc](https://github.com/rboudrouss/ocaml-emcc) in compiled mode
(c_of_ocaml, then emcc). They run in a Web Worker and fetch plugins and
libraries when a document needs them.

## Two builds

| | full | compat |
|-|------|--------|
| target | wasm64 (63-bit OCaml integers) | the same code, its memory lowered to 32 bits |
| deep recursion | `--jspi` | `--cps-stack` |
| plugins | wasm side modules, fetched on `Declare ML Module` (`--dynlink`) | the same, lowered and with `--cps-stack` |
| browsers | Chrome and Edge 137+, Firefox 153+ | all with wasm tail calls |
| memory | up to 16 GB | up to 4 GB |
| `.vo` files | those of the switch | the same |

At startup the page checks that `WebAssembly.validate` accepts a module with
a 64-bit memory and that `WebAssembly.Suspending` (JSPI) exists. If either is
missing it uses compat. `?build=compat` or `?build=full` in the URL forces
one.

### Why compat is 64-bit code

A wasm32 Rocq, with 31-bit OCaml integers, would need its own `.vo` files.
Rocq picks its primitive integers by word size (`uint63_31.ml` is a boxed
`Int64`, `uint63_63.ml` an immediate), so marshalled terms differ, and a
32-bit OCaml cannot read the 63-bit integers of a 64-bit `.vo`.

Compat is therefore the code of full, compiled for wasm64 and sharing its
objects, but linked with emscripten's `MEMORY64=2`. Binaryen's
`--memory64-lowering` turns 64-bit addresses into addresses in a 32-bit
memory, and the code keeps computing with 64-bit pointers and integers. The
result runs in engines without memory64 and reads the same `.vo`. Plugins
are the same side modules, lowered the same way
(`EMCC_CFLAGS=-sMEMORY64=2` for `ocaml-emcc plugin`).

Without JSPI, deep recursions continue in CPS on the heap (`--cps-stack`,
which works with `--dynlink` since ocaml-emcc 09ee06a). They still grow
emscripten's C stack through over-applications and C functions, so that
stack is the limit. It is 64 MB and checked with
`-sSTACK_OVERFLOW_CHECK=2`, so an overflow aborts the worker instead of
overwriting the static data below the stack. The check has no measurable
cost.

Compat keeps wasm tail calls and needs an engine that has them (Safari 18.2,
Firefox 121, Chrome 112 and later). `make compat NO_TAIL_CALLS=1` turns them
into ordinary calls, but then a deep recursion aborts the worker inside
c_of_ocaml (see [status.md](status.md)).

### Messages without JSPI

CPS does not cover callbacks from C or JavaScript, so the worker's loop stays
in `main`. Without JSPI to suspend it, it blocks on `Atomics.wait` while
waiting for a message, and a blocked worker never receives a `postMessage`.
The page sends its messages and its file operations through memory shared
with the worker instead (`app/src/lib/channel.ts`, read by
`web/rocq-web-io.js`). This needs a cross-origin isolated page, as the
interrupts do.

## Plugins

The plugins loaded by Corelib's prelude (ltac, number_string_notation,
tauto, cc, firstorder, and coq-lsp's serlib for each) are linked into the
worker, which starts faster than loading them. All others are side modules.

Rocq resolves `Declare ML Module "pkg"` with findlib and `Dynlink`. The
worker installs its own loader with `Mltop.set_top`, without patching Rocq.
Package `pkg` maps to the side module `plugins/pkg.wasm`, which
`ocaml-emcc plugin` builds from the package's `.cma` against this exact
build of the program, interfaces checked. The plugins are thus versioned
with the program. A plugin may use the libraries of plugins loaded before
it (elpi, then rocq-elpi).

Opam installs plugins built by coq_makefile as native code only, since
coq_makefile builds a `.cma` only with `make byte`. The `Makefile` compiles
their bytecode from the package sources in `_build/byte-plugins/`.

## Packages

For each build, an opam package such as rocq-mathcomp-ssreflect is made of
`.vo` and `.glob` files, `.v` sources for go to definition, plugins, and an
entry in a JSON manifest with its logical paths and dependencies. The `.vo`
built by the native 64-bit Rocq load as they are in the full build.

In the worker, these files are lazy entries of emscripten's file system,
fetched on first read and then kept. The files Rocq reads at startup (the
prelude's `.vo`, findlib's META files) come in a single request instead,
`boot.bin`, fetched while the worker's WebAssembly compiles. Their list is
`web/boot-files.txt`, recorded by `tests/startup.mjs --record`.

A `Require` reads a `.vo`, then the libraries it requires, then theirs. For a
large library this is hundreds of files (406 for MetaRocq's
`Common.EnvironmentReflect`), and one synchronous request per file would
cost a round trip each. So the manifest records what each file needs
(`scripts/assets.mjs`). For a `.vo`, that is the libraries of its summary
(`scripts/vo-deps.ml`) and the plugins it declares. For a plugin, it is what
findlib loads before it.

The first read of a file starts downloading everything it needs that is not
there yet, 16 files at a time. A worker of `web/rocq-web-fs.js` writes them
into shared memory, and each read waits for its file with `Atomics.wait`.
A file outside the manifest, or whose download failed, falls back to a
synchronous request. Files are fetched with their version (`?v=`) and the
browser caches them for good.

The app's package browser lists the opam packages that contain Rocq
libraries (`packages.json`, from the switch's metadata) with their modules.

## The user's files

The app keeps the files in the browser's local storage, organised in folders.
The page also writes them into the worker's file system
(`web/rocq-web-fs.js`, with messages handled between two of Rocq's steps),
so `Load` reads them. Files Rocq writes there, like `Extraction` output, are
listed, shown and downloadable. `/workspace` is the worker's current
directory.

### Workspaces

A folder can be a workspace, a Rocq project of its own. Its files are the
modules `NAME.*`, where `NAME` is the folder's name, as its project file
says. That file is generated (`-R . NAME`) unless the user writes one in the
folder (`_RocqProject` or `_CoqProject`, menu "Write its _RocqProject").
Files outside any workspace are the modules `Workspace.DIR.NAME`, unless a
`_RocqProject` at the root says otherwise. Imported folders and examples
become workspaces. Workspaces do not nest.

Each workspace sees the others, and files at the root see all of them. Their
modules are required by qualified name (`From Lib Require Base`,
`Require Lib.Base`). The generated project files add a `-Q` for each
directory of the other workspaces' load paths, relative to the folder
(`-Q ../Lib Lib`). The root's project file adds them with `-R` instead.
coq-lsp adds a project's `-Q` before its `-R`, and the root's
`-R . Workspace` covers the workspaces' folders, so it would bind them last
(Rocq binds a folder to a single name, and the warning for a folder bound
twice is off). A project file written by the user decides for itself what it
sees. "Write its _RocqProject" starts from the generated one, so these lines
are there. The root's files are in no workspace's load path.

Each workspace is a coq-lsp workspace folder (`/workspace/DIR`), with the
root `/workspace` last, since coq-lsp takes the first folder that contains a
file. The generated project files are written into the worker. When a
project file changes or a workspace is added or removed, coq-lsp reads them
again without restarting Rocq through `workspace/didChangeWorkspaceFolders`.
The workspace is removed and added again, or all of them for the root's
project file since coq-lsp searches them from the last added, and the
document is reopened.

### Libraries added by the user

A library of Rocq files is added as a workspace from the Packages panel ("Add
a library", `app/src/hooks/useLibraries.ts` and `app/src/lib/library.ts`).
Archives imported from the Files panel become libraries too. A library can
come from a GitHub repository, an archive URL whose server allows it, or an
archive (zip, tar, tar.gz, `app/src/lib/archive.ts`) or folder on disk.

GitHub repositories are fetched through jsDelivr. `data.jsdelivr.com` lists
the files and `cdn.jsdelivr.net/gh/OWNER/REPO@REF/` serves them. GitHub's own
archives on `codeload.github.com` cannot be used from another site because
of CORS.

The library's project file at its top is kept, along with the `.v` of the
directories it names. Its OCaml plugins (`Declare ML Module`) cannot be
built in the browser yet, so only the build's packages have plugins, and the
app says so.

### Compiling dependencies

Before checking a file, the app compiles the files it requires, in order.
Each one is opened in coq-lsp, written as a `.vo` by `coq/saveVo`, then
closed. `coq/saveVo` is patched to refuse a document with errors, and to
name the module from the document's own load path rather than the one left
by another document (otherwise a workspace renamed by its project file would
compile under its former name). `coq/workspace_update` then makes coq-lsp
check again with these `.vo`. It is patched so that documents opened later
do not reuse what an earlier `Require` loaded.

Switching files closes the previous one. coq-lsp's caches are kept, so going
back to a file is quick. `coq/trimCaches` (two `Gc.full_major`, which take
seconds before the worker checks the next file) is sent only when the
workspaces are read again, since the cached states have the former load
paths.

Compiled `.vo` are kept in IndexedDB, the most recently used up to 256 MB.
They are keyed by a SHA-256 of what they were compiled from: the version of
the worker's libraries (a hash of their files, sent by the worker at
startup), the file's module, its workspace's project file (or its name, for
a generated one), its text, and the `.vo` of the files it requires. On the
next page load, the app writes them into the worker instead of compiling
again.

### Step by step checking

Step by step checking uses coq-lsp's `check_only_on_request`. A document is
checked only up to the points of requests, here the goals at the point the
page moves one sentence at a time, to the cursor, to the start or to the
end. The page finds sentences itself (`app/src/lib/sentences.ts`). It stops
before the first error in the diagnostics, since coq-lsp checks past errors,
and moves the point back before an edit.

### Goals

Goals are Rocq documents (`pp_format` "Pp"). The page lays them out for the
panel's width (`app/src/components/goals/Pp.tsx`, Format's boxes and
breaks). The goals before the sentence (`mode` "Prev" at its start) give
what it changed. Words outside the longest common subsequence of the two are
highlighted.

### Search

Library search uses an index of the declarations in their sources
(`search.tsv`, 129,000 declarations, 2 MB with brotli). It is written with
the assets and downloaded on the first search.

## Interrupts

The worker cannot receive messages while Rocq computes. The page shares a
flag with it in a SharedArrayBuffer, which requires a cross-origin isolated
page, and sets it on each edit. A minor GC hook in the worker
(`worker/plugins/interrupt.c`) reads the flag and sets `Control.interrupt`.
Rocq's next `Control.check_for_interrupt` turns it into `Sys.Break`, then
coq-lsp handles the edit and checks again from there.

Rocq's reductions (`Eval compute`, unification) never check for interrupts.
An interrupt still pending after half a second is raised by a Memprof
callback, at an allocation, while coq-lsp runs a command. Native coq-lsp
does the same with memprof-limits, on OCaml 4.14 only.

`Timeout` works by replacing Rocq's `Control.timeout` through
`Control.set_timeout`. Rocq's own uses `setitimer` and `SIGALRM`, which
WebAssembly never delivers. The same Memprof callback raises
`Control.Timeout` once the deadline has passed.

## Not supported

`native_compute` runs ocamlopt and loads the result, which cannot happen in
the browser. Rocq falls back to `vm_compute`, which works since Rocq's VM is
C. Plugins that run external programs (coq-hammer's provers) or compile
OCaml at run time (QuickChick) do not work either.
