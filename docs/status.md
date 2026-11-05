# Status

## Full build (wasm64 + JSPI)

- rocq-runtime's C stubs build for wasm64 (needed ocaml-emcc 476f822:
  its configure, run on the host, adds `-msse2 -mfpmath=sse`).
- Blocked: c_of_ocaml fails on Rocq's `clib/cObj.ml`, with or without
  `--dynlink`:

  ```ocaml
  let size_of_double = Obj.size (Obj.repr 1.0)
  ```

  ```
  $ ocamlfind ocamlc -c repro.ml && c_of_ocaml --word-size 64 repro.cmo -o repro.c
  c_of_ocaml: v1 would need to be boxed
  ```

  (`--word-size 32` too; c_of_ocaml 872d24b1.) A program without
  `--dynlink` gets through only when global dead code removes it.

## Compat build (wasm32 + CPS stack)

Waits for `--cps-stack` with `--dynlink` in ocaml-emcc.
