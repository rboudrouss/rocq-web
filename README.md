# rocq-web

Rocq in the browser, compiled to WebAssembly with
[ocaml-emcc](https://github.com/rboudrouss/ocaml-emcc), with its plugins
and libraries (mathcomp...) fetched when a document needs them. Work in
progress: see [docs/design.md](docs/design.md).

## Layout

| path | what |
|------|------|
| `worker/` | the OCaml program: Rocq, with `Declare ML Module` loading wasm plugins |
| `scripts/build.sh` | builds the worker and Rocq's plugins for the full or compat build |
| `web/detect.js` | picks the build a browser runs (memory64 and JSPI, or not) |
| `docs/design.md` | the two builds (wasm64 + JSPI, wasm32 + CPS stack), plugins, packages |
