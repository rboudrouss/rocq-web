#!/usr/bin/env bash
# Requires modules of each package of the switch (packages.json of the
# build: the first, middle and last of its modules), with the native Rocq
# and with the worker of the build under node, and reports those that load
# natively but not in the worker (a plugin missing or failing):
#   tests/packages.sh [full|compat] [PACKAGE...]
set -u
cd "$(dirname "$0")/.."
. scripts/env.sh >/dev/null
build=${1:-full}; shift || true
out=$PWD/out/$build
export ROCQ_WEB_PLUGINS=$out/plugins ROCQLIB=$OPAM_SWITCH_PREFIX/lib/coq
# the minor heap of the web worker (scripts/assets.mjs)
export OCAMLRUNPARAM=s=4M,o=120
dir=$(mktemp -d)
node -e '
  const [file, ...only] = process.argv.slice(1);
  for (const p of JSON.parse(require("fs").readFileSync(file, "utf8"))) {
    if (only.length && !only.includes(p.name)) continue;
    const m = p.modules, pick = [...new Set([m[0], m[m.length >> 1], m[m.length - 1]])];
    console.log(p.name, ...pick);
  }' "$out/web/packages.json" "$@" > "$dir/list"
fail=0
while read -r name modules; do
  for m in $modules; do
    v=$dir/t_$(tr -c 'A-Za-z0-9_\n' _ <<< "$m").v
    echo "Require $m." > "$v"
    (cd "$dir" && rocq compile -q "$(basename "$v")" > "$v.native" 2>&1) || { echo "skip $name $m (native: $(head -c 120 "$v.native" | tr '\n' ' '))"; continue; }
    if (cd "$dir" && node "$out/rocq_web.js" compile "$(basename "$v")" > "$v.wasm" 2>&1); then
      echo "ok   $name $m"
    else
      echo "FAIL $name $m: $(grep -v '^File' "$v.wasm" | head -c 300 | tr '\n' ' ')"
      fail=1
    fi
  done
done < "$dir/list"
rm -rf "$dir"
exit $fail
