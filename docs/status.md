# Status

## Full build (wasm64 + JSPI)

Works in Chromium (headless: `tests/browser.mjs`, `files.mjs`,
`goals.mjs`, `navigation.mjs`, `workspace.mjs`, `examples.mjs`,
`search.mjs`, `interrupt.mjs`, `startup.mjs`, `page.mjs` (with
`support.v`, `packages_plugins.v`), `packages.mjs`; also from
another machine through ssh, `tests/remote.sh`) and under node
(`tests/compare.sh`, `packages.sh`, `lsp.mjs`), Rocq 9.2 with coq-lsp
0.2.5 (its v9.2 branch), from the development server and from the static
site (`scripts/dist.mjs`, `scripts/serve.mjs`).

The app (`app/`):

- several files in folders (a tree: folded folders, a menu on a right
  click, rows dragged onto a folder), kept in the browser; folders
  imported (picked, dropped from disk, or opened on disk with Chrome's
  File System Access API, edits written back), each a workspace with its
  generated or own project file, read again when it changes; a
  `_RocqProject` at the root; zip archives of the files or a folder; a
  file requiring another (`Require Import A.`) is checked after it is
  compiled (`coq/saveVo`), again when it changed, and its errors shown if
  it does not compile; `Load`; the files Rocq writes (`Extraction`), shown
  and downloaded; a link sharing a file (its text in the URL), downloads;
- diagnostics, the Problems panel, hover, completion (identifiers,
  unicode input: `\forall`);
- the goals at the cursor laid out for the panel's width, what the
  sentence changed highlighted, hypotheses folded;
- checking as you type, or up to the cursor (Alt+Enter); the next and
  previous sentences (Alt+N, Alt+P) and problems (F8, Shift+F8);
- `Timeout`; `native_compute` (Rocq falls back to its VM, `vm_compute`:
  the same results, the VM's speed);
- the panels on the left chosen (or closed) by an activity bar;
- the outline of the file (documentSymbol), queries at the cursor
  (`Search`, `About`, `Check`... through petanque, the document
  unchanged);
- go to definition (F12, Ctrl+click) in the files and in the sources of
  the libraries, shown read only;
- the package browser: the opam packages with their modules, a click
  inserts the `Require`; the search of the declarations of the libraries'
  sources;
- examples, from a menu or a link (`?example=Basics`), and the page
  embedded in another (`?embed`: its files in memory only; without
  cross-origin isolation in an iframe, edits do not interrupt Rocq);
- edits interrupt the command being checked, reductions included
  (`Eval compute`: Rocq is idle again a second after the edit); Restart
  starts a new worker (a computation of the VM, which nothing interrupts);
  a worker that stopped is shown;
- the libraries' files being downloaded are shown;
- the system's dark mode.

Libraries are fetched when required. The switch has the opam packages
with Rocq libraries for 9.2: Stdlib, mathcomp (ssreflect, algebra, field,
character, solvable, finmap, multinomials, zify, classical, analysis,
reals...), Hierarchy-Builder and rocq-elpi, Equations, MetaRocq
(template), Iris and stdpp, Flocq, Coquelicot, Interval, CoRN,
math-classes, ExtLib, ITree, Paco, AAC tactics, relation-algebra,
bignums, coqprime, hammer's tactics, four colour, infotheo, monae,
autosubst, deriving, extructures, TLC, LibHyps...; their plugins are side
modules (the prelude's are linked in the worker). `tests/packages.mjs`
requires three modules of each package, a worker for each package: all
load (157 modules of 57 packages); `tests/packages_plugins.v` uses a
plugin of each (Equations, AAC, hammer's `sauto`, MetaRocq's quoting,
bignums, relation-algebra, coinduction, Iris's proof mode, Interval), in
20 s from a cold start in the app.

| | size (brotli) |
|-|------|
| `lsp_worker.wasm` | 36 MB (5.8 MB) |
| `boot.bin`, the files read when Rocq starts | 1 MB (0.35 MB) |
| libraries and plugins (`dist/rocq/full`) | 816 MB (290 MB), fetched file by file |

The first load transfers about 6.6 MB; Rocq is ready about 1.5 s after
the page loads and has checked a first sentence at about 1.9 s (headless
Chromium, local server, a loaded machine).

### Known problems

- Starting: V8 compiles c_of_ocaml's function initialising every module
  (1.5 million lines of wasm text) when it is called, which takes a large
  part of the start (0.8 s in a profile under node, on a loaded machine).
- Opam packages built with coq_makefile install no bytecode:
  `scripts/byte-plugins.sh` compiles their plugins from the sources.
- Not available for Rocq 9.2 in opam: unicoq, mtac2, paramcoq, itauto,
  smpl, waterproof, QuickChick, graph-theory, algebra-tactics; failing to
  build: reduction-effects, categories.
- Memory: coq-lsp keeps what it loaded; a worker that required 110
  modules of 37 packages in turn used 9.5 GB (Restart frees it).
- An interrupt from a Memprof callback is an exception at any allocation
  in Rocq (as with memprof-limits in native coq-lsp): a lazy value being
  forced then raises it again later. Only once the command has not
  checked for interrupts for half a second.

## Compat build (wasm64 lowered to wasm32 + CPS stack)

Works (docs/design.md): `tests/*.mjs` with `ROCQ_WEB_BUILD=compat` in
Chromium (JSPI hidden from the page) and Firefox (JSPI disabled): goals,
navigation, workspace, search, files, interrupts (Ltac and reductions),
`support.v`; `rocq_web.js` under node gives the native outputs. Its
`.wasm` is about 100 MB (36 MB for full: CPS versions), checked in 3 s in
Chromium, 18 to 24 s in Firefox (development server, no brotli).

### Known problems

- `Search (_ + S _ = S (_ + _))` overflows the stack in the worker (JS
  `Maximum call stack size exceeded`, the worker stops), as does the
  Basics example: Rocq's `Constr_matching.sub_match`
  (`try_sub_match_rec`, `try_aux`, `next`, closures) recurses about 2 000
  deep from `main` without a CPS bounce (no `camlc_cps_depth` decrement in
  its cycle), c_of_ocaml bd0845e8. Reproduced under node:
  `OCAML_EMCC_STACK_MB=1 node tests/lsp.mjs out/compat/lsp_worker.js F.v`
  with F.v the first 32 lines of `app/public/examples/Basics/Basics.v`
  (`rocq repl` of the compat build runs the same `Search` without it).
- Memory: 4 GB at most (a 32-bit memory).
- Without cross-origin isolation the page cannot share memory with the
  worker, which then cannot receive messages: compat needs it.

## Next

- Compat: the stack overflow of `Search` (above), in c_of_ocaml.
