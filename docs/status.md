# Status

## Full build (wasm64 + JSPI)

Rocq 9.2 (coq-lsp's main branch targets 9.2), under node:

- `rocq_web compile` checks files (`tests/compare.sh full`); Corelib's
  `.vo` built by the native 64-bit Rocq load as they are; Rocq's 27
  plugins are side modules loaded on `Declare ML Module`.
- `lsp_worker` is coq-lsp's server, its loop in `main` suspending (JSPI)
  until a message arrives: `node tests/lsp.mjs out/full/lsp_worker.js
  tests/proof.v 2:2` gives diagnostics and goals (1.3 s for proof.v).
  Serlib's plugins are not built yet (coq-lsp warns: incremental checking
  of the plugins' commands is degraded).

| | size |
|-|------|
| `lsp_worker.wasm` | 32 MB |
| `rocq_web.wasm` | 21 MB |

### Blocker: deep recursions through tail calls with JSPI

`Check 1024.` (and `vm_compute` printing 1024) overflows the stack with
`--jspi`, not without (node's 1 GB stack). Rocq's `cbv_stack_term` and
`cbv_stack_value` call each other in tail position, with different
signatures: c_of_ocaml emits `musttail` only for identical signatures,
and clang does not make the others wasm tail calls when the function also
returns early (the exception checks). Each such call keeps its frame on the
engine's stack while releasing its frame on the shadow stack, so the
segmented stack never sees the depth and never switches stacks (940
levels, 1 KB each, in the 984 KB of a JSPI stack). Fixing it is in
c_of_ocaml: keep (part of) the frame across tail calls that are not
`musttail`, or make them bounce.

Fixed on the way: ocaml-emcc 476f822 (x86 flags from Rocq's configure),
d7584a2 (`Sys.chdir` under `--node-fs`); c_of_ocaml fd6db6e0 (numbers
given to `Obj.size`), 5f602e6c (`Gc.ramp_up`, under which Rocq loads its
libraries, ran without new segments as a callback from C).

## Compat build (wasm32 + CPS stack)

Waits for `--cps-stack` with `--dynlink` in ocaml-emcc.

## Next

- The worker in a browser: emscripten's file system (lazy files, findlib
  META) instead of `--node-fs`, web/rocq-web-io.js's Web Worker side, an
  editor (coq-lsp's VS Code extension in VS Code web, or CodeMirror).
- Interrupting a command (shared memory flag read by Rocq).
- Serlib's plugins; Stdlib (lia, ring...) and mathcomp packages.
