# Status

## Full build (wasm64 + JSPI)

Works in Chromium (headless, `tests/browser.mjs`, `tests/interrupt.mjs`,
`tests/page.mjs`) and under node (`tests/compare.sh`, `tests/lsp.mjs`),
Rocq 9.2 with coq-lsp 0.2.5 (its v9.2 branch):

- the app (`app/`): CodeMirror, diagnostics, goals at the cursor, hover,
  completion (identifiers, unicode input: `\forall`), the document kept in
  the browser;
- libraries fetched when required: Corelib, Ltac2, Stdlib, mathcomp
  (ssreflect, algebra), Hierarchy-Builder, rocq-elpi; the example checks
  in about 5 s from a cold start, `tests/mathcomp.v` (HB structures) in
  4.5 s;
- plugins as side modules loaded on `Declare ML Module` (62: Rocq's,
  serlib's, rocq-elpi's with elpi's libraries, micromega's);
- edits interrupt the command being checked (shared memory, a minor GC
  hook of the worker); coq-lsp restarts from the new text.

| | size |
|-|------|
| `lsp_worker.wasm` (web) | 33 MB |
| plugins | 62 side modules |
| libraries (`out/full/web/coqlib`) | 280 MB, fetched file by file |

### Known problems

- Reductions (`Eval compute`, unification) do not check for interrupts
  in Rocq: an edit stops them only once they reach a check (native
  coq-lsp uses memprof-limits, which needs Gc.Memprof: c_of_ocaml's
  allocations do not sample).
- c_of_ocaml (reported to its session): a loop of Ltac's interpreter
  (`do 10 (do 1000 (do 1000 idtac))`) fills the shadow stack where native
  Rocq runs in constant stack; emscripten's C stack overflows silently
  (linked with 256 MB).

Fixed on the way: ocaml-emcc 476f822 (x86 flags from Rocq's configure),
d7584a2 (`Sys.chdir` under `--node-fs`); c_of_ocaml fd6db6e0 (numbers
given to `Obj.size`), 5f602e6c (`Gc.ramp_up` ran without new segments),
its session's 6e147c7e (tail calls of different signatures: `Check 1024.`
overflowed with JSPI).

## Compat build (wasm32 + CPS stack)

Not built yet: ocaml-emcc now supports `--cps-stack` with `--dynlink`
(09ee06a); needs a 31-bit set of `.vo` (Rocq built for wasm32).

## Next

- Production build of the app (static server with COOP/COEP), faster
  start (Prelude's files in one request, compile cache).
- The compat build.
- More of the interface: a package browser, several files (OPFS),
  messages panel, outline (documentSymbol).
