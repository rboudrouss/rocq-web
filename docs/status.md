# Status

Rocq 9.2 with coq-lsp 0.2.5 (its v9.2 branch).

## Full build (wasm64 and JSPI)

Tested in headless Chromium by the browser tests (`tests/*.mjs`, also run
from another machine through `tests/remote.sh`) and under node by
`tests/compare.sh`, `packages.sh` and `lsp.mjs`, from both the development
server and the static site. Firefox 153+ picks this build too but is not
covered by the tests yet.

### The app

**Files.** Files live in folders in the browser, shown as a tree with
folding, a context menu and drag and drop. Folders can be picked, dropped
from disk, or opened on disk with Chrome's File System Access API (edits are
written back). Each imported folder is a workspace with a generated or
hand-written project file, read again when it changes, and the root can have
a `_RocqProject` too. Files and folders export as zip archives. `Load`
works, and files Rocq writes (`Extraction`) are shown and downloadable. A
link shares the current file or all files, their text in the URL, with
their libraries (see Libraries).

**Dependencies.** A file that requires another (`Require Import A.`) is
checked once that file is compiled with `coq/saveVo`, and again when it
changes. If the dependency does not compile, its errors are shown. This
works within a workspace and across workspaces (`From Lib Require`). The
compiled `.vo` are kept in the browser between page loads.

**Libraries.** Libraries of Rocq files can be added from GitHub (through
jsDelivr), from archives (zip, tar.gz) or from folders. Each becomes a
workspace and is listed with its modules in the Packages panel. A
repository added without a ref is fetched at the last commit of its default
branch, and links name that commit. `?lib=SPEC` in a link adds a library, a
repository (`owner/repo@ref`) or an archive's URL, and can be repeated.
Libraries already there are not fetched again, and the parameter is then
removed from the URL. `?open=SPEC` opens files as a project, in a
workspace named after the folder, the repository or the archive: those of a GitHub
repository (`owner/repo[@ref]`), of one of its folders
(`owner/repo@ref:folder`, or `https://github.com/owner/repo/tree/REF/FOLDER`),
or of an archive's URL. It keeps the files an import keeps, and opens the
one `?file=NAME` names, else the first Rocq file. The package browser lists the opam packages with
their modules, and clicking one inserts its `Require`. The declarations of
the libraries' sources can be searched.

**Sharing.** The Share dialog rebuilds the link, or the HTML of an iframe
embedding the page, and copies it at each change. It shares the current file or all
files, leaving out those of the libraries the link adds. It lists the
libraries added from GitHub or a URL, those the file requires checked
first, and takes others for the link only, a repository pinned to its last
commit by default. It warns of links over 8 KB, which chats and mail may
cut, and over 2 MB, which Chrome does not open. A shared file whose path
already holds another text is renamed (`N_1.v`, or a folder `F_2/`). Its
(i) buttons explain each part, including what an embed needs.

**Checking.** By default the file is checked step by step as in RocqIDE.
The checked part is green, checking stops before an error, and the goals
are those at that point. The other mode checks as you type and shows the
goals at the cursor. Diagnostics, the Problems panel, hover and completion
(identifiers and unicode input like `\forall`) work in both. `Timeout`
works, and `native_compute` falls back to Rocq's VM with the same results.

| key | action |
|-----|--------|
| Alt+↓ or Alt+N, Alt+↑ or Alt+P | check the next sentence, step back one |
| Alt+→, Alt+Enter, Ctrl+Enter | check up to the cursor |
| Alt+Home, Alt+End | check up to the start, the end |
| F8, Shift+F8 | next, previous problem |
| F12, Ctrl+click | go to definition |

On macOS, Ctrl+Cmd replaces Alt in the arrow, Home and End keys. The header
has buttons for the same moves.

**Goals.** Goals are laid out for the panel's width, with foldable
hypotheses. What the last sentence changed can be highlighted (off by
default, as in RocqIDE).

**Navigation.** The file outline comes from documentSymbol. Queries at the
cursor (`Search`, `About`, `Check`...) go through petanque and leave the
document unchanged. Go to definition works in the user's files and in the
libraries' sources, which open read only.

**Interrupts.** An edit interrupts the command being checked, reductions
included. After `Eval compute`, Rocq is idle again about a second after the
edit. Restart starts a new worker, for the VM's computations that nothing
interrupts. A worker that stopped is shown as such.

**Interface.** An activity bar picks the panel on the left or closes it.
Library downloads in progress are shown. The page follows the system's dark
mode. Examples open from a panel or a link (`?example=Basics`). The page
can be embedded in another with `?embed`, its files then kept in memory
only, like its libraries and the files it opens, which are fetched again
at each load (`?embed&lib=...`, `?embed&open=...`). In a page without cross-origin isolation the full build
runs, but edits do not interrupt Rocq and the compat build does not start.
A page served with COOP `same-origin` and COEP `require-corp` or
`credentialless` makes the iframe isolated too, given
`allow="cross-origin-isolated"`, which the Share dialog's HTML has. The site
sends CORP `cross-origin` for that, without which such a page does not load
it at all (tested in Chromium by `tests/library_links.mjs`).

**Phones.** Below 760 pixels wide, the editor sits above the goals and a
drag shares the height between them. Touching a line number checks up to
that line. With the keyboard open, the goals fit on one line above it, with
the moves and Rocq's symbols. Panels open over the page.

### Packages

Libraries are fetched when required. The switch has the opam packages with
Rocq libraries for 9.2, among them Stdlib, mathcomp (ssreflect, algebra,
field, analysis, reals, finmap...), Hierarchy-Builder and rocq-elpi,
Equations, MetaRocq, Iris and stdpp, Flocq, Coquelicot, Interval, CoRN,
math-classes, ExtLib, ITree, Paco, AAC tactics, relation-algebra, bignums,
hammer's tactics and the four colour theorem. Their plugins are side
modules, except the prelude's, which are linked into the worker.

`tests/packages.mjs` requires three modules of each package, in a fresh
worker per package. All 157 modules of the 57 packages load.
`tests/packages_plugins.v` uses a plugin from each of Equations, AAC,
hammer's `sauto`, MetaRocq's quoting, bignums, relation-algebra,
coinduction, Iris's proof mode and Interval. It checks in 20 s from a cold
start in the app.

### Size and startup

| | size | with brotli |
|-|------|-------------|
| `lsp_worker.wasm` | 36 MB | 5.8 MB |
| `boot.bin`, the files Rocq reads at startup | 1 MB | 0.35 MB |
| libraries and plugins (`dist/rocq/full`), fetched file by file | 816 MB | 290 MB |

The first load transfers about 6.6 MB. Rocq is ready about 1.5 s after the
page loads and has checked a first sentence at about 1.9 s (headless
Chromium, local server, busy machine).

### Known problems

- V8 compiles c_of_ocaml's function that initialises every module (1.5
  million lines of wasm text) when it is first called. This is a large part
  of the startup time, 0.8 s in a profile under node on a busy machine.
- Opam packages built with coq_makefile install no bytecode, so the
  `Makefile` compiles their plugins from source.
- Not available in opam for Rocq 9.2: unicoq, mtac2, paramcoq, itauto,
  smpl, waterproof, QuickChick, graph-theory, algebra-tactics. Failing to
  build: reduction-effects, categories.
- coq-lsp keeps everything it loaded. A worker that required 110 modules of
  37 packages in turn used 9.5 GB. Restart frees it.
- An interrupt from the Memprof callback is an exception raised at any
  allocation in Rocq, as with memprof-limits in native coq-lsp. A lazy value
  being forced at that moment raises it again later. This only happens when
  a command has not checked for interrupts for half a second.

## Compat build (wasm64 lowered to wasm32, CPS stack)

The browser tests pass with `ROCQ_WEB_BUILD=compat` in Chromium (JSPI hidden
from the page) and in Firefox with JSPI disabled. This covers goals,
navigation, workspaces, search, files, interrupts (Ltac and reductions) and
`support.v`. Under node, `rocq_web.js` gives the same outputs as native
Rocq.

Its `.wasm` is about 100 MB, against 36 MB for full, because of the CPS
versions of the functions. It compiles in 3 s in Chromium and 18 to 24 s in
Firefox (development server, no brotli).

### Known problems

- Memory is limited to 4 GB.
- Without wasm tail calls (`make compat NO_TAIL_CALLS=1`, ocaml-emcc's
  `--no-tail-calls`, c_of_ocaml 006e2612), the browser tests pass in
  Chromium but a deep recursion aborts the worker.
  `Eval compute in Nat.even (Nat.pow 3 11)` fails with "Fatal error:
  c_of_ocaml: arity 0", under node too, while it works with tail calls.
  Compat therefore keeps them and needs an engine that has them (Safari
  18.2, Firefox 121, Chrome 112).
- Without cross-origin isolation the page cannot share memory with the
  worker, which then cannot receive messages at all.
