# Status

## Full build (wasm64 + JSPI)

Works under node (`scripts/build.sh full`, `tests/compare.sh full`):
`rocq_web compile` checks files with the output of the native Rocq,
Corelib's `.vo` built by the native 64-bit Rocq load as they are, and
Rocq's plugins (23 side modules, 30 KB to 2.9 MB) are loaded on
`Declare ML Module`. `vm_compute` works.

| | size |
|-|------|
| `rocq_web.wasm` | 21 MB |
| plugins | 14 MB in all (ltac 2.7 MB, ltac2 2.9 MB) |

| file | native | wasm64 under node |
|------|--------|-------------------|
| empty, `-noinit` | 0.03 s | 0.72 s |
| empty | 0.07 s | 0.89 s |
| `tests/plugins.v` | 0.38 s | 2.0 s |

Needed fixes: ocaml-emcc 476f822 (x86 flags from Rocq's configure),
d7584a2 (`Sys.chdir` under `--node-fs`), c_of_ocaml fd6db6e0 (numbers
given to `Obj.size`, Rocq's CObj).

## Compat build (wasm32 + CPS stack)

Waits for `--cps-stack` with `--dynlink` in ocaml-emcc.

## Next

- Stdlib (lia, ring...) as a heavier test.
- The worker in a browser: emscripten's file system with lazy files
  instead of `--node-fs`, an interactive protocol.
