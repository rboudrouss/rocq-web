# Status

## Full build (wasm64 + JSPI)

Works in Chromium (headless: `tests/browser.mjs`, `files.mjs`,
`interrupt.mjs`, `startup.mjs`, `page.mjs`) and under node
(`tests/compare.sh`, `tests/lsp.mjs`), Rocq 9.2 with coq-lsp 0.2.5 (its
v9.2 branch), from the development server and from the static site
(`scripts/dist.mjs`, `scripts/serve.mjs`).

The app (`app/`):

- several files, kept in the browser; a file requiring another
  (`Require Import A.`) is checked after it is compiled (`coq/saveVo`),
  again when it changed;
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
  (`Eval compute`: Rocq is idle again a second after the edit).

Libraries are fetched when required. The switch has 44 opam packages with
Rocq libraries: Stdlib, mathcomp (ssreflect, algebra, field, character,
solvable, finmap, multinomials, zify, classical, analysis...),
Hierarchy-Builder and rocq-elpi, Equations, MetaRocq (template), Iris and
stdpp, Flocq, Coquelicot, Interval, CoRN, math-classes, ExtLib, ITree,
Paco, AAC tactics, relation-algebra, bignums, coqprime, hammer's tactics,
four colour (reals), infotheo, monae, autosubst, deriving, extructures...;
their plugins are side modules (the prelude's are linked in the worker).
Each must be checked in the app: only Stdlib, mathcomp and HB are tested
(`tests/mathcomp.v`).

| | size (brotli) |
|-|------|
| `lsp_worker.wasm` | 36 MB (5.8 MB) |
| `boot.bin`, the files read when Rocq starts | 1 MB (0.35 MB) |
| libraries and plugins (`dist/rocq/full`) | 596 MB (205 MB), fetched file by file |

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
  smpl, waterproof, QuickChick, graph-theory, algebra-tactics.
- An interrupt from a Memprof callback is an exception at any allocation
  in Rocq (as with memprof-limits in native coq-lsp): a lazy value being
  forced then raises it again later. Only once the command has not
  checked for interrupts for half a second.

Fixed on the way: ocaml-emcc 476f822 (x86 flags from Rocq's configure),
d7584a2 (`Sys.chdir` under `--node-fs`); c_of_ocaml fd6db6e0 (numbers
given to `Obj.size`), 5f602e6c (`Gc.ramp_up` ran without new segments);
its session's 6e147c7e (tail calls of different signatures), a60e2e2f
(over-applications used emscripten's C stack and were not tail calls:
Ltac loops, 256 MB of C stack no longer needed), c36b6187 (Gc alarms),
bd0845e8 (Memprof callbacks run, and raise, at allocations); coq-lsp:
documents opened after `coq/workspace_update` (patch 0002).

## Compat build (wasm32 + CPS stack)

Not built yet: ocaml-emcc supports `--cps-stack` with `--dynlink`
(09ee06a); needs a 31-bit set of `.vo` (Rocq built for wasm32).

## Next

- The compat build.
- Check each package of the switch in the app.
- Files on disk (the File System Access API), a project's `_RocqProject`.
