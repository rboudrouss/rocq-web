#!/usr/bin/env bash
# Compiles each tests/*.v with the native Rocq and with the worker of a
# build (make full or compat), under node, and compares their outputs:
#   tests/compare.sh [full|compat] [FILE.v...]
set -u
cd "$(dirname "$0")"
eval "$(make -s -C .. env)"
build=${1:-full}; shift || true
out=$PWD/../out/$build
files=("$@"); [ ${#files[@]} -gt 0 ] || files=(*.v)
export ROCQ_WEB_PLUGINS=$out/plugins ROCQLIB=${ROCQLIB:-$OPAM_SWITCH_PREFIX/lib/coq}
fail=0
for v in "${files[@]}"; do
  t0=$(date +%s%N)
  rocq compile "$v" > "/tmp/rocq-web-native.$$" 2>&1
  t1=$(date +%s%N)
  node "$out/rocq_web.js" compile "$v" > "/tmp/rocq-web-wasm.$$" 2>&1
  t2=$(date +%s%N)
  times="native $(( (t1 - t0) / 10000000 ))0 ms, wasm $(( (t2 - t1) / 10000000 ))0 ms"
  if diff "/tmp/rocq-web-native.$$" "/tmp/rocq-web-wasm.$$" > "/tmp/rocq-web-diff.$$"; then
    echo "PASS $v ($times)"
  else
    echo "FAIL $v ($times)"; head -10 "/tmp/rocq-web-diff.$$"; fail=1
  fi
done
rm -f /tmp/rocq-web-{native,wasm,diff}.$$
exit $fail
