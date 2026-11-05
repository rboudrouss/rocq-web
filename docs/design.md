# Design

Rocq in the browser, compiled to WebAssembly by
[ocaml-emcc](https://github.com/rboudrouss/ocaml-emcc) (compiled mode:
c_of_ocaml + emcc), with its plugins and libraries (mathcomp...) fetched
when a document needs them.

## Two builds

| | full | compat |
|-|------|--------|
| target | wasm64 (63-bit OCaml integers) | wasm32 (31-bit) |
| deep recursion | `--jspi` | `--cps-stack` |
| plugins | wasm side modules, fetched on `Declare ML Module` (`--dynlink`) | linked in the program (`--cps-stack` does not support `--dynlink`) |
| browsers | memory64 and JSPI: Chrome/Edge 137+ (Firefox once it ships JSPI) | all |
| `.vo` files | a 63-bit set | a 31-bit set |

The page picks the build at startup: `WebAssembly.validate` on a module
with a 64-bit memory, and `WebAssembly.Suspending` for JSPI. Either missing
means compat.

### Why two sets of `.vo`

Rocq picks its 63-bit integers and floats with `int_size`
(`uint63_63.ml` or `uint63_31.ml`): on wasm32 a primitive integer is a
boxed `Int64`, on wasm64 an immediate. Marshalled terms (`.vo`) differ, so
each build gets libraries compiled by a Rocq of the same word size, with
the same Rocq version and the same plugins.

### Compat build and plugins

Without dynamic loading, compat links a fixed set of plugins (Rocq's own,
and those of the libraries offered: rocq-elpi for Hierarchy-Builder and
mathcomp 2, Equations...). Packages needing another plugin are offered by
the full build only.

## Plugins

Rocq resolves `Declare ML Module "pkg"` with findlib and `Dynlink`. The
worker installs its own loader with `Mltop.set_top` (no patch to Rocq):
package `pkg` is the side module `plugins/pkg.wasm`, made by
`ocaml-emcc plugin` from the package's `.cma` against this exact build of
the program (interfaces are checked), so the plugin set is versioned with
the program. A plugin may use the libraries of the plugins loaded before
it (elpi, then rocq-elpi).

## Packages

A package (opam package, e.g. rocq-mathcomp-ssreflect) is, per build:
`.vo`/`.glob` files, `.v` sources (go to definition), plugins, and an entry
of a JSON manifest (logical paths, dependencies). In the worker the files
are lazy entries of emscripten's file system, fetched with a synchronous
request on first read (allowed in a worker), then cached.

## Not supported

- `native_compute` (it runs ocamlopt and loads the result); `vm_compute`
  works, Rocq's VM is C.
- Plugins that run external programs (coq-hammer's provers) or compile
  OCaml at run time (QuickChick).

## Open questions

- Interrupting a running command: a flag in shared memory the worker
  checks in `Control.check_for_interrupt` (needs SharedArrayBuffer, i.e.
  COOP/COEP headers), otherwise kill the worker and replay the document.
- Protocol: coq-lsp (rocq-lsp) in the worker, or Rocq's own.
- Whether `.vo` files built by a native 64-bit Rocq load in the full build.
