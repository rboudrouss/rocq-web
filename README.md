# rocq-web

The [Rocq prover](https://rocq-prover.org) in the browser, with no server.

**[rocq.rboud.com](https://rocq.rboud.com/)**

Rocq 9.2 and its language server [coq-lsp](https://github.com/ejgallego/coq-lsp)
are compiled to WebAssembly and run on your machine. Your files stay in your
browser.

## Features

The editor shows the goals at the cursor and what each tactic changed. It
checks the file as you type, or step by step like RocqIDE. Errors, hover,
completion, go to definition (into library sources too), the outline and
queries like `Search` or `About` work as in a desktop IDE.

A project can have several files and folders and a `_RocqProject`. Files
that require one another are compiled in the browser. Projects can be opened
from a folder on disk or a zip archive.

57 packages are available and downloaded only when a file requires them,
among them the standard library, Mathematical Components, Iris, Equations,
MetaRocq and Flocq. Other libraries can be added from a GitHub repository,
an archive or a folder.

The Share button gives a link to the current file or to all files, with
their libraries, or the HTML that embeds the page in another site
(`?embed`). A link with `?lib=owner/repo@tag` adds that library when it
opens. `lib` also takes an archive's URL and can be repeated.

## Limitations

- `native_compute` falls back to the VM, with the same results.
- A library added by hand cannot bring OCaml plugins, since these cannot be
  built in the browser yet.
- A heavy session can use several GB of memory. Restart frees it.

## Browsers

Chrome and Edge 137+ and Firefox 153+ run the full build (wasm64 with JSPI),
which can use up to 16 GB of memory. Older browsers run the compat build, the
same code with a 32-bit memory. It starts slower and is limited to 4 GB.
Safari 18.2+ should work but is untested. The page picks the build by itself.

## How it works

Rocq and coq-lsp are compiled from OCaml to C by c_of_ocaml, then to
WebAssembly by emscripten, using [ocaml-emcc](https://github.com/rboudrouss/ocaml-emcc).
Rocq plugins become WebAssembly side modules, loaded on `Declare ML Module`.

The language server runs in a Web Worker and fetches library files from the
site as Rocq opens them. The web app (React and CodeMirror) talks to it over
LSP.

More in [docs/design.md](docs/design.md).

## Documentation

- [docs/building.md](docs/building.md) to build the worker, the app and the site, and run the tests
- [docs/deploying.md](docs/deploying.md) to serve the site, on Cloudflare Pages and R2 or elsewhere
- [docs/design.md](docs/design.md) for the two builds, plugins, packages and interrupts
- [docs/status.md](docs/status.md) for what works in each build and known problems

## Repository layout

| path | contents |
|------|----------|
| `worker/` | the OCaml programs, coq-lsp's server for a Web Worker and Rocq |
| `web/` | JavaScript linked into the worker for its messages and files |
| `app/` | the web app (pnpm, Vite, React, CodeMirror) |
| `Makefile` | the whole build, from the toolchain to the site |
| `scripts/` | worker assets, the static site, Cloudflare deployment |
| `emcc-recipes/` | coq-lsp's sources and the patches applied to it, an ocaml-emcc recipe |
| `tests/` | comparisons with native Rocq, LSP tests, browser tests |
| `docs/` | the documentation above |

## License

rocq-web is under the [MIT License](LICENSE), except for
`emcc-recipes/coq-lsp/patches/` and `worker/lsp_worker.ml`, adapted from
[coq-lsp](https://github.com/rocq-community/rocq-lsp), which keep its
license, the LGPL 2.1. Rocq, coq-lsp, the Rocq packages the site serves
and the tools that build it have their own licenses.
