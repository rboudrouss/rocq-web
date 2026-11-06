# Status

## Full build (wasm64 + JSPI)

Works in Chromium (headless: `tests/browser.mjs`, `files.mjs`,
`interrupt.mjs`, `startup.mjs`, `page.mjs`, `packages.mjs`; also from
another machine through ssh, `tests/remote.sh`) and under node
(`tests/compare.sh`, `packages.sh`, `lsp.mjs`), Rocq 9.2 with coq-lsp
0.2.5 (its v9.2 branch), from the development server and from the static
site (`scripts/dist.mjs`, `scripts/serve.mjs`).

The app (`app/`):

- several files, kept in the browser, or the `.v` files of a folder on
  disk (Chrome's File System Access API, edits written back); a file
  requiring another (`Require Import A.`) is checked after it is compiled
  (`coq/saveVo`), again when it changed; a link sharing a file (its text
  in the URL), downloads;
- diagnostics, the Problems panel, goals at the cursor, hover, completion
  (identifiers, unicode input: `\forall`);
- the outline of the file (documentSymbol), queries at the cursor
  (`Search`, `About`, `Check`... through petanque, the document
  unchanged);
- go to definition (F12, Ctrl+click) in the files and in the sources of
  the libraries, shown read only;
- the package browser: the opam packages with their modules, a click
  inserts the `Require`;
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
| libraries and plugins (`dist/rocq/full`) | 816 MB, fetched file by file |

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

## Compat build (wasm32 + CPS stack)

Not built yet: ocaml-emcc supports `--cps-stack` with `--dynlink`
(09ee06a); needs a 31-bit set of `.vo` (Rocq built for wasm32).

## Next

- The compat build.
- Check each package of the switch in the app.
- Files on disk (the File System Access API), a project's `_RocqProject`.
