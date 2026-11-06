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
| `scripts/byte-plugins.sh` | the bytecode of plugins opam installs native only (coq_makefile's) |
| `scripts/dist.mjs`, `scripts/serve.mjs` | the static site (`dist/`, brotli), a server for it (COOP/COEP) |
| `deploy/Dockerfile`, `scripts/deploy.sh` | its image, deployed to Coolify |
| `web/` | JavaScript linked in the worker: its messages (`rocq-web-io.js`), its files (`rocq-web-fs.js`) |
| `app/` | the web app (pnpm, Vite, React, CodeMirror): files, outline, packages, goals, queries, coq-lsp client |
| `tests/` | native comparison (`compare.sh`, `packages.sh`), LSP over stdio (`lsp.mjs`), headless Chromium (`browser.mjs`, `files.mjs`, `interrupt.mjs`, `startup.mjs`, `page.mjs`, `packages.mjs`), on another machine (`remote.sh`) |
| `docs/status.md` | where each build stands, blockers |
| `docs/design.md` | the two builds (wasm64 + JSPI, wasm32 + CPS stack), plugins, packages |

## Running

```sh
scripts/vendor.sh                      # coq-lsp, patched
. scripts/env.sh
scripts/byte-plugins.sh                # once the switch's Rocq packages are installed
scripts/build.sh full
cd app && pnpm install && pnpm dev     # http://localhost:5173/, Chrome or Edge 137+
```

The static site, served cross-origin isolated (COOP and COEP: the
interrupts of Rocq need it), with brotli:

```sh
node scripts/dist.mjs                  # dist/
node scripts/serve.mjs dist 8080       # http://localhost:8080/
```

On a Coolify application of this machine (a Docker image, through a
local registry):

```sh
node scripts/dist.mjs && scripts/deploy.sh APP_UUID
```

Elsewhere, the server must send `Cross-Origin-Opener-Policy: same-origin`
and `Cross-Origin-Embedder-Policy: require-corp` (`dist/_headers` for
Netlify and Cloudflare Pages), and `Content-Encoding: br` for `FILE.br`
when it exists. On hosts without headers (GitHub Pages), a service worker
(`coi.js`) adds them at the second load.
