# Building

```sh
make            # both builds, then the static site in dist/
make full       # the full build only, in out/full/
make compat     # the compat build only, in out/compat/
make serve      # dist/ at http://localhost:8080/
```

A build takes a while, mostly because of the plugins, so a machine with many
cores helps (see `JOBS` below).

## Prerequisites

- An opam switch named `rocq-web` with OCaml 5.4.1, `rocq-core` 9.2.0,
  `js_of_ocaml`, `ocaml-emcc` (pinned from its repository, 9b35258 or
  later, for coq-lsp's recipe) and the Rocq packages the site should
  offer. The build ships every package of the switch.
  [status.md](status.md) lists the current ones.
- c_of_ocaml 083e5706 or later, built separately as described in
  ocaml-emcc's README. It is looked up in `~/C_of_ocaml`, or set
  `C_OF_OCAML=...`. With an older one, Ltac loops overflow the stack and
  reductions cannot be interrupted.
- emscripten (emsdk) in `~/tools/emsdk`, or set `EMSDK=...`.
- node 24 or later, taken from nvm if present (`NODE_DIR=...`), and pnpm
  for the app.

The `Makefile` sets up this environment by itself. To get it in a shell, run
`eval "$(make -s env)"`. Use `SWITCH=...` for a switch with another name.

## The worker and the plugins

`make full` and `make compat` write their output in `out/BUILD/`. The
`Makefile` is commented step by step and doubles as an example of a large
OCaml program built with ocaml-emcc.

1. ocaml-emcc builds coq-lsp's OCaml libraries for WebAssembly, into its
   sysroot, from the recipe `emcc-recipes/coq-lsp/`. opam has no coq-lsp
   for Rocq 9.2, so the recipe names its sources (a commit of the v9.2
   branch), and its `patches/` change what rocq-web needs (see each
   patch). This happens once, and again when the recipe changes.
2. ocaml-emcc compiles three dune executables to C, then to WebAssembly.
   `rocq_web.js` is `rocq compile`, used by the tests under node.
   `lsp_worker.js` is coq-lsp under node, and the program the plugins are
   linked against. `web/lsp_worker.js` is coq-lsp for a Web Worker.
3. `ocaml-emcc plugin` compiles each plugin from its bytecode archive to a
   side module. This covers the plugins declared by the switch's
   libraries, coq-lsp's serlib for each, and the findlib packages they need
   that the worker does not link. Opam installs coq_makefile plugins as
   native code only, so their bytecode is first compiled from the package
   sources in `_build/byte-plugins/`.
4. `scripts/assets.mjs` puts in `web/` what the page serves, the worker and
   Rocq's files.

| build | browsers | memory |
|-------|----------|--------|
| `full` | Chrome and Edge 137+, Firefox 153+ (memory64 and JSPI) | 64-bit, up to 16 GB |
| `compat` | the others | the same code lowered to 32 bits, up to 4 GB |

The page picks one at startup. `?build=full` or `?build=compat` in the URL
forces it. [design.md](design.md) explains the difference.

| variable | effect |
|----------|--------|
| `JOBS` | plugins compiled in parallel (half the cores by default, to save memory) |
| `STACK` | emscripten's C stack (64MB by default for compat) |
| `NO_TAIL_CALLS=1` | compat without wasm tail calls (a deep recursion then aborts the worker, see [status.md](status.md)) |
| `OCAML_EMCC_JOBS` | parallel compilation of the C by ocaml-emcc (environment variable) |

`make plugins BUILD=full` rebuilds only the plugins, for instance after
adding packages to the switch. `make -k` keeps going past a plugin that
fails.

## The app

```sh
cd app && pnpm install && pnpm dev     # http://localhost:5173/
```

The development server serves `out/BUILD/web` through the links
`app/public/rocq/BUILD`.

## The static site

`make dist` writes the built app and the files of both builds to `dist/`,
each file with a brotli copy `FILE.br`. `make serve` serves it the way it
must be served, cross-origin isolated (Rocq's interrupts need it) and
compressed. Set `PORT=...` to change the port. [deploying.md](deploying.md)
covers putting it online.

## Tests

| command | what it checks |
|---------|----------------|
| `tests/compare.sh [full\|compat]` | each `tests/*.v` with native Rocq and with the worker under node, outputs compared |
| `tests/packages.sh` | every package of the switch loads under node |
| `tests/lsp.mjs` | coq-lsp over stdio |
| `node tests/NAME.mjs [URL]` | the app in headless Chromium (`browser`, `goals`, `workspace`, `interrupt`...), at `http://localhost:5173/` by default |
| `tests/remote.sh [-p PORT] HOST TEST.mjs` | one browser test run on another machine, reaching the local app through ssh |

Browser tests take playwright from `PLAYWRIGHT_DIR` (`~/tools/pw` by
default). Install it there with `npm i playwright`, then
`npx playwright install chromium`. `BROWSER=firefox` or `BROWSER=webkit`
changes the browser, `ROCQ_WEB_BUILD=compat` makes the page pick compat, and
`SCREENSHOT=FILE.png` saves a screenshot for the tests that take one.
`tests/libraries.mjs` needs the network to fetch a library from GitHub.
