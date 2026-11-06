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
| `web/` | JavaScript linked in the worker: its messages (`rocq-web-io.js`), its files (`rocq-web-fs.js`) |
| `app/` | the web app (pnpm, Vite, React, CodeMirror): editor, goals, coq-lsp client, build detection |
| `tests/` | native comparison (`compare.sh`), LSP over stdio (`lsp.mjs`), headless Chromium (`browser.mjs`) |
| `docs/status.md` | where each build stands, blockers |
| `docs/design.md` | the two builds (wasm64 + JSPI, wasm32 + CPS stack), plugins, packages |

## Running

```sh
scripts/vendor.sh                      # coq-lsp, patched
. scripts/env.sh && scripts/build.sh full
cd app && pnpm install && pnpm dev     # http://localhost:5173/, Chrome or Edge 137+
```
