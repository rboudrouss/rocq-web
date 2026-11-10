#!/usr/bin/env bash
# Builds the worker and Rocq's plugins for one build of docs/design.md:
#   scripts/build.sh full     wasm64 + JSPI
#   scripts/build.sh compat   CPS stack, memory64 lowered to wasm32
# into out/<build>/: rocq_web.js (rocq compile/repl), lsp_worker.js (coq-lsp),
# their .wasm, plugins/<findlib name>.wasm, and web/ for a Web Worker
# (lsp_worker.js and the files it reads)
set -euo pipefail
cd "$(dirname "$0")/.."

build=${1:-full}
plugin=()
# emscripten's C stack: ocaml-emcc's default unless ROCQ_WEB_STACK
stack=(${ROCQ_WEB_STACK:+--stack-size "$ROCQ_WEB_STACK"})
case $build in
  full) flags=(--target wasm64) link=(--jspi "${stack[@]}") ;;
  # the same 64-bit code (63-bit OCaml integers, the same .vo), its
  # memory64 lowered to a 32-bit memory by binaryen (emscripten's
  # MEMORY64=2, for the program and its plugins: EMCC_CFLAGS)
  # Deep recursions in CPS leave emscripten's C stack, which they still
  # grow (over-applications, C functions), as the limit: 64 MB (8 MB
  # overflows on Eval compute in Nat.even (Nat.pow 3 11), 177147 deep),
  # checked (an overflow aborts instead of writing over the static data
  # placed below it), at no measured cost. ROCQ_WEB_NO_TAIL_CALLS=1:
  # without wasm tail calls (--no-tail-calls, its plugins too), for the
  # engines that lack them; a deep recursion then aborts the worker
  # (docs/status.md)
  compat)
    flags=(--target wasm64)
    if [ -n "${ROCQ_WEB_NO_TAIL_CALLS:-}" ]; then plugin=(--no-tail-calls); fi
    link=(--cps-stack "${plugin[@]}" --stack-size "${ROCQ_WEB_STACK:-64MB}" --emcc-flag -sSTACK_OVERFLOW_CHECK=2)
    export EMCC_CFLAGS="${EMCC_CFLAGS:+$EMCC_CFLAGS }-sMEMORY64=2" ;;
  *) echo "usage: $0 full|compat" >&2; exit 2 ;;
esac

OCAML_EMCC=${OCAML_EMCC:-ocaml-emcc}
out=out/$build
mkdir -p "$out/plugins"
# --node-fs: run under node with the host files (Rocq's, findlib's), until
# the browser worker has its own file system.
scripts/vendor.sh
# ROCQ_WEB_PLUGINS_ONLY: the plugins of the worker already built (new
# packages in the switch)
if [ -z "${ROCQ_WEB_PLUGINS_ONLY:-}" ]; then
  # (the three at the same time, each in its own work directory: ocaml-emcc
  # compiles the parts of their C in parallel too, OCAML_EMCC_JOBS)
  pids=()
  "$OCAML_EMCC" "${flags[@]}" build "$out/rocq_web.js" --exe worker/rocq_web "${link[@]}" --node-fs &
  pids+=($!)
  # coq-lsp's server, its messages from web/rocq-web-io.js
  "$OCAML_EMCC" "${flags[@]}" build "$out/lsp_worker.js" --exe worker/lsp_worker "${link[@]}" --node-fs \
    -- --pre-js web/rocq-web-io.js &
  pids+=($!)

  # The same for a Web Worker: Rocq's files in emscripten's file system
  # (web/rocq-web-fs.js, scripts/assets.mjs)
  "$OCAML_EMCC" "${flags[@]}" build "$out/web/lsp_worker.js" --exe worker/lsp_worker "${link[@]}" \
    -- --pre-js web/rocq-web-io.js --pre-js web/rocq-web-fs.js -sENVIRONMENT=web,worker -sFORCE_FILESYSTEM=1 &
  pids+=($!)
  for p in "${pids[@]}"; do wait "$p"; done
fi

# The plugins, side modules named after their findlib package: those the
# libraries of the switch declare (Declare ML Module in Corelib and
# user-contrib), coq-lsp's serlib plugins (coq-lsp.serlib.<plugin>, its
# serialization of their syntax, loaded instead of the plugin, which it
# requires), and the packages they need which the worker does not link
# (elpi for rocq-elpi...). coq-lsp's packages are in the install tree of
# the build, where findlib finds them, their archives in _build.
ctx=default.${flags[1]}
"$OCAML_EMCC" "${flags[@]}" dune @vendor/coq-lsp/serlib/plugins/all "_build/install/$ctx/lib/coq-lsp/META"
export OCAMLPATH=$PWD/_build/install/$ctx/lib
roots=$( (grep -rhoE 'Declare ML Module "[^"]+"' "$OPAM_SWITCH_PREFIX/lib/coq" | sed 's/.*"\(.*\)"/\1/'
  ocamlfind list 2>/dev/null | awk '$1 ~ /^coq-lsp\.serlib\./ {print $1}') | sort -u)
# the packages linked in the worker: the libraries of lsp_worker (worker/dune)
libs=$(sed -n '/(name lsp_worker)/,/^$/p' worker/dune | sed -n '/(libraries/,$p' | tr -d '()' |
  tr -s ' ' '\n' | grep -vxE 'libraries|rocq_web_plugins|lsp_io' | grep .)
linked=$(ocamlfind query -r -format '%p' $libs findlib ocaml-emcc.dynlink | sort -u)
for f in "$out"/plugins/*.wasm; do
  if grep -qx "$(basename "$f" .wasm)" <<< "$linked"; then rm "$f"; fi
done
# (ROCQ_WEB_JOBS at a time, default half the cores, for the memory: each
# compiles on one core, in its own work directory)
jobs=${ROCQ_WEB_JOBS:-$(( ($(nproc) + 1) / 2 ))}
failed=$(mktemp)
trap 'rm -f "$failed"' EXIT
for pkg in $(ocamlfind query -r -format '%p' $roots | awk '!seen[$0]++'); do
  if grep -qx "$pkg" <<< "$linked"; then continue; fi
  case $pkg in
    coq-lsp.*) cma=$(find "_build/$ctx/vendor/coq-lsp" -name "$(ocamlfind query -predicates byte -format '%a' "$pkg")" | head -1) ;;
    *) cma=$(ocamlfind query -predicates byte -format '%d/%a' "$pkg") ;;
  esac
  case $cma in */fake.cma | */ | "") continue ;; esac
  # (packages installed without their bytecode, coq_makefile's: built by
  # scripts/byte-plugins.sh)
  [ -f "$cma" ] || cma=_build/byte-plugins/$(basename "$(dirname "$cma")")/$(basename "$cma")
  if [ ! -f "$cma" ]; then echo "$pkg (no $(basename "$cma"): scripts/byte-plugins.sh)" >> "$failed"; continue; fi
  [ -f "$out/plugins/$pkg.wasm" ] && [ "$out/plugins/$pkg.wasm" -nt "$cma" ] && [ "$out/plugins/$pkg.wasm" -nt "$out/lsp_worker.wasm" ] && continue
  while [ "$(jobs -rp | wc -l)" -ge "$jobs" ]; do wait -n || true; done
  { "$OCAML_EMCC" "${flags[@]}" plugin "${plugin[@]}" "$cma" -o "$out/plugins/$pkg.wasm" --main "$out/lsp_worker.js" ||
      echo "$pkg" >> "$failed"; } &
done
wait
while read -r f; do echo "plugin not built: $f" >&2; done < "$failed"

node scripts/assets.mjs "$build" "$out/web"
