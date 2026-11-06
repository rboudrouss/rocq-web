# native_compute in the browser (thoughts, nothing built)

## Today

Rocq is configured without its native compiler (`Coq_config.native_compiler
= NativeOff`): `native_compute`, the `native_compute` tactic and
`native_cast_no_check` fall back to Rocq's VM (`vm_compute`), which works
(the VM is C, compiled with the worker). Files using them check; only the
speed of the native compiler is missing.

## What Rocq does natively

- `Nativenorm.native_norm` (pretyping, for `native_compute`) and
  `Nativeconv.native_conv` (kernel, for `native_cast_no_check` at `Qed`)
  compile the term, and the constants it needs (on demand), to OCaml
  (`Nativecode`), write a `.ml`, and run `ocamlfind ocamlopt -shared`
  (`ocamlc -c` when Rocq is bytecode) through `Nativelib.call_compiler`.
- The result is loaded in Rocq's process (`Dynlink.loadfile`, or
  `Nativelib.load_obj` for bytecode); its code sets `Nativelib.rt1`, a
  value of `Nativevalues` (blocks, closures, accumulators holding kernel
  terms).
- `Nativenorm` reads the value back into a term, applying its closures to
  accumulators (calls back into the compiled code), looking up inductive
  types in the environment; `Nativeconv` compares two values the same way.

The generated code and the value it computes are intertwined with Rocq's
heap: closures are applied, accumulators hold `constr`s, the environment
is consulted all along.

## The idea: wasm_of_ocaml in the worker

Compile the generated `.ml` in the browser with `ocamlc` (compiler-libs,
built with ocaml-emcc) and wasm_of_ocaml (itself built with ocaml-emcc),
then run the module next to the worker, through the bridge of the
`wsoo-bridge` branch of ocaml-emcc.

The bridge connects wasm_of_ocaml code to C compiled by emscripten; values
cross by copy (custom blocks copied, no shared heap: WasmGC values on one
side, linear memory on the other). That fits data, not the values of
`Nativevalues` (closures, accumulators updated in place, kernel terms).

So the boundary would be whole operations, not values:

- A second Rocq, partial and AOT-compiled with wasm_of_ocaml: `Nativevalues`,
  `Nativenorm`, `Nativeconv` and the kernel modules they use (names,
  terms, environments, inductives, reduction).
- `native_norm env sigma c ty` and `native_conv` in the worker replaced
  (a hook, as `Nativelib.load_obj` already is) by a call to it: the term,
  its type and `sigma` marshalled (Marshal's format is the same on both
  sides), the normal form marshalled back.
- The environment cannot be copied whole (mathcomp's is hundreds of MB):
  its lookups would call back into the worker, a constant's or an
  inductive's body marshalled on demand and cached.
- In it, the generated `.ml` compiled per query: `ocamlc -c` against the
  `.cmi` of its kernel modules, then wasm_of_ocaml, linked and instantiated
  with the modules already loaded (wasm_of_ocaml's separate compilation
  and its dynamic linking of units).

Parts to build:

1. `ocamlc` in the worker (or a second worker): compiler-libs with
   ocaml-emcc, the stdlib's and the kernel's `.cmi` shipped.
2. wasm_of_ocaml in the worker: an OCaml program, buildable with
   ocaml-emcc, but it runs binaryen's tools (wasm-merge, wasm-opt) as
   processes; binaryen.js (binaryen compiled to wasm) instead, or no
   optimisation.
3. The wasm_of_ocaml Rocq (kernel subset), built ahead of time, with its
   environment lookups as calls to the worker.
4. The hooks in the worker (`native_norm`, `native_conv`), and
   `native_compiler` set to on demand.

## Is it worth it

Native `native_compute` beats `vm_compute` on long computations, and
costs a compilation per query (ocamlopt, about a second). Here:

- the compilation would be slower (ocamlc, wasm_of_ocaml and binaryen in
  wasm, a few seconds per query);
- wasm_of_ocaml's code is slower than native code, Rocq's VM in wasm also
  slower than native: the ratio between them is what counts;
- marshalling terms and environment lookups adds to each query.

The first step is that measurement, outside the browser: a
`native_compute` benchmark's generated `.ml` (Rocq keeps it with
`-d native-compiler`), compiled with
wasm_of_ocaml against `Nativevalues` and the kernel modules it needs, run
under node, compared with `vm_compute` in the worker. If wasm_of_ocaml is
not several times faster than the VM there, the VM fallback is the better
deal.

## Other ways, not better

- Bytecode, as a bytecode Rocq does (`ocamlc -c`, then loaded in the
  process): ocaml-emcc's worker is compiled, it would need an interpreter
  sharing its heap, and interpreted OCaml is no faster than Rocq's VM.
- c_of_ocaml in the browser: it needs a C compiler (clang in wasm, tens of
  MB) for each query.
