# rocq-web

The [Rocq prover](https://rocq-prover.org) (formerly Coq) running entirely
in the browser: Rocq 9.2 and its language server,
[coq-lsp](https://github.com/ejgallego/coq-lsp), compiled to WebAssembly,
in an editor made for proofs. No server checks anything: once the page is
loaded, Rocq runs on your machine, and your files stay in your browser.

**Try it: [rocq.rboud.com](https://rocq.rboud.com/)**

It comes with the libraries most developments use, fetched only when a
file requires them: the standard library, Mathematical Components (and
analysis), Iris and stdpp, Equations, MetaRocq, Hierarchy-Builder and
rocq-elpi, Flocq, Coquelicot, Interval, CoRN, ExtLib, ITree, Paco... 57
packages in all, their plugins included.

## What it does

- **Proofs as in an IDE**: the goals at the cursor, what each step
  changed, checking as you type or step by step (as RocqIDE), errors and
  warnings, hover, completion, go to definition (into the libraries'
  sources too), the outline of a file, queries (`Search`, `About`,
  `Check`...).
- **Several files and projects**: folders, a `_RocqProject`, files
  requiring one another (compiled in the browser, their `.vo` kept),
  folders imported or opened from disk, zip archives.
- **Libraries**: the packages above, browsed with their modules and
  searched by declaration; other Rocq libraries added from a GitHub
  repository or an archive.
- **Sharing**: a link with a file's text, examples and tutorials, the
  page embedded in another (`?embed`).

Its limits: Rocq's `native_compute` falls back to its VM (same results);
a library added by hand cannot bring OCaml plugins, which cannot be built
in the browser; the memory is the browser's (a heavy session may use
several GB, Restart frees it).

## Browsers

| | build | |
|-|-------|-|
| Chrome, Edge 137+ | full (wasm64 with JSPI) | up to 16 GB of memory |
| Firefox, older Chromium (Safari 18.2+: untested) | compat (the same code, a 32-bit memory) | slower to start, up to 4 GB |

The page picks the build itself.

## How it works

The OCaml of Rocq and coq-lsp is compiled to C by c_of_ocaml, then to
WebAssembly by emscripten, through
[ocaml-emcc](https://github.com/rboudrouss/ocaml-emcc); Rocq's plugins are
WebAssembly side modules loaded on `Declare ML Module`. The language
server runs in a Web Worker, which reads the libraries' files from the
site as Rocq opens them. The web app (React, CodeMirror) talks to it as an
LSP client. [docs/design.md](docs/design.md) has the details.

## Documentation

| | |
|-|-|
| [docs/building.md](docs/building.md) | the toolchain, building the two builds, the app, the static site, the tests |
| [docs/deploying.md](docs/deploying.md) | serving the site (cross-origin isolation, brotli): Docker, Cloudflare Pages and R2 |
| [docs/design.md](docs/design.md) | the two builds, plugins, packages, workspaces and libraries, interrupts |
| [docs/status.md](docs/status.md) | what works in each build, known problems |
| [docs/native-compute.md](docs/native-compute.md) | thoughts on `native_compute` in the browser |

## Layout

| path | what |
|------|------|
| `worker/` | the OCaml programs: coq-lsp's server for a Web Worker, and Rocq, with `Declare ML Module` loading wasm plugins |
| `web/` | JavaScript linked in the worker: its messages (`rocq-web-io.js`), its files (`rocq-web-fs.js`) |
| `app/` | the web app (pnpm, Vite, React, CodeMirror) |
| `scripts/` | building (`build.sh`, `byte-plugins.sh`, `vendor.sh`, `env.sh`), the static site (`dist.mjs`, `serve.mjs`), deploying (`deploy.sh`, `cloudflare.mjs`, `r2-upload.sh`) |
| `vendor/`, `patches/` | coq-lsp, and the patches applied to it |
| `deploy/` | the Docker image of the site |
| `tests/` | comparisons with the native Rocq, LSP over stdio, the app in headless Chromium |
| `docs/` | the documentation above |
