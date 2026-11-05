#!/usr/bin/env bash
# Builds the worker and Rocq's plugins for one build of docs/design.md:
#   scripts/build.sh full     wasm64 + JSPI
#   scripts/build.sh compat   wasm32 + CPS stack (waits for ocaml-emcc to
#                             support --cps-stack with --dynlink)
# into out/<build>/: rocq_web.js, rocq_web.wasm, plugins/<findlib name>.wasm
set -euo pipefail
cd "$(dirname "$0")/.."

build=${1:-full}
case $build in
  full) flags=(--target wasm64) link=(--jspi) ;;
  compat)
    flags=(--target wasm32) link=(--cps-stack)
    if [ -z "${ROCQ_WEB_COMPAT:-}" ]; then
      echo "compat: needs --cps-stack with --dynlink in ocaml-emcc (ROCQ_WEB_COMPAT=1 to try)" >&2
      exit 1
    fi ;;
  *) echo "usage: $0 full|compat" >&2; exit 2 ;;
esac

out=out/$build
mkdir -p "$out/plugins"
# --node-fs: run under node with the host files (Rocq's, findlib's), until
# the browser worker has its own file system.
ocaml-emcc "${flags[@]}" build "$out/rocq_web.js" --exe worker/rocq_web "${link[@]}" --node-fs

# Rocq's own plugins: each findlib package rocq-runtime.plugins.* whose
# archive is a real library (the parent packages only hold fake.cma).
for pkg in $(ocamlfind list 2>/dev/null | awk '$1 ~ /^rocq-runtime\.plugins\./ {print $1}'); do
  cma=$(ocamlfind query -predicates byte -format '%d/%a' "$pkg")
  case $cma in */|*/fake.cma) continue ;; esac
  ocaml-emcc "${flags[@]}" plugin "$cma" -o "$out/plugins/$pkg.wasm" --main "$out/rocq_web.js"
done
