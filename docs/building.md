# Building

rocq-web is Rocq 9.2 and coq-lsp compiled to WebAssembly by
[ocaml-emcc](https://github.com/rboudrouss/ocaml-emcc) (c_of_ocaml, then
emscripten), and a web app (`app/`) that runs them in a Web Worker. A
build takes a while (the worker, then each plugin of the switch's
packages): a machine with many cores helps, `ROCQ_WEB_JOBS` below.

## Prerequisites

- An opam switch named `rocq-web`, OCaml 5.4.1, with `rocq-core` 9.2.0,
  the Rocq packages the site should offer (mathcomp, Iris,
  Equations...: the build takes those of the switch, `docs/status.md`
  lists them), `js_of_ocaml` and `ocaml-emcc` (pinned from its
  repository).
- c_of_ocaml 083e5706 or later, built apart (ocaml-emcc's README): in
  `~/C_of_ocaml`, which `scripts/env.sh` finds, or named by
  `OCAML_EMCC_C_OF_OCAML`. An older one builds a worker whose Ltac loops
  overflow the stack, whose reductions cannot be interrupted, and whose
  compat build overflows on `Search`.
- emscripten (emsdk) in `~/tools/emsdk`, or `EMSDK`.
- node 24 or later (wasm64 and JSPI, for the tests under node), and pnpm
  for the app.

`scripts/env.sh` sets them up in a shell: emsdk, the switch, c_of_ocaml,
node from nvm.

## The worker and the plugins

```sh
scripts/vendor.sh                      # vendor/coq-lsp, patches/ applied
. scripts/env.sh
scripts/byte-plugins.sh                # once the switch's Rocq packages are installed
scripts/build.sh full                  # and/or compat
```

`scripts/byte-plugins.sh` compiles to bytecode the plugins opam installs
native only (coq_makefile's), which ocaml-emcc needs. `scripts/build.sh`
writes `out/BUILD/`: `lsp_worker.js` (coq-lsp) and `rocq_web.js` (`rocq
compile`, for the tests under node), their `.wasm`, the plugins as side
modules, and `web/`, what the page serves (the worker and Rocq's files).
The two builds (`docs/design.md`):

| build | for | |
|-------|-----|-|
| `full` | Chrome and Edge 137+ (memory64 and JSPI) | 64-bit memory, up to 16 GB |
| `compat` | the other browsers | the same code, its memory lowered to 32 bits, up to 4 GB |

The page picks one at startup (`?build=full` or `?build=compat` in its URL
forces it).

Environment variables of `scripts/build.sh`:

| variable | |
|----------|-|
| `ROCQ_WEB_JOBS` | plugins compiled at a time (default: half the cores, for the memory) |
| `OCAML_EMCC_JOBS` | ocaml-emcc's parallel compilation of the C |
| `ROCQ_WEB_PLUGINS_ONLY=1` | the plugins only, the worker already built (packages added to the switch) |
| `ROCQ_WEB_STACK` | emscripten's C stack (compat: 64MB by default) |
| `ROCQ_WEB_NO_TAIL_CALLS=1` | compat without wasm tail calls (`docs/status.md`: a deep recursion then aborts the worker) |

## The app

```sh
cd app && pnpm install && pnpm dev     # http://localhost:5173/
```

The development server serves `out/BUILD/web` (`app/public/rocq/BUILD` are
links to them).

## The static site

The app built and each build's files, with their brotli compression
(`FILE.br`):

```sh
node scripts/dist.mjs                  # dist/
node scripts/serve.mjs dist 8080       # http://localhost:8080/
```

`scripts/serve.mjs` serves it as it must be: cross-origin isolated (the
interrupts of Rocq need it) and compressed. To put it online:
[deploying.md](deploying.md).

## Tests

| | |
|-|-|
| `tests/compare.sh [full\|compat]` | each `tests/*.v` with the native Rocq and with the worker under node, their outputs compared |
| `tests/packages.sh` | the switch's packages loaded under node |
| `tests/lsp.mjs` | coq-lsp over stdio |
| `tests/*.mjs` (`browser`, `files`, `goals`, `navigation`, `workspace`, `libraries`, `examples`, `search`, `interrupt`, `startup`, `downloads`, `page`, `packages`, `probe`) | the app in headless Chromium: `node tests/NAME.mjs [URL]` (default `http://localhost:5173/`) |
| `tests/remote.sh [-p PORT] HOST TEST.mjs` | one of those on another machine, which reaches the app served here through ssh |

The tests in a browser take playwright from `PLAYWRIGHT_DIR` (default
`~/tools/pw`: `npm i playwright` there, then `npx playwright install
chromium`); `BROWSER=firefox` or `webkit`, `ROCQ_WEB_BUILD=compat` (the
page made to pick compat), `SCREENSHOT=FILE.png` for those that take one.
`tests/libraries.mjs` needs the network (a library from GitHub).
