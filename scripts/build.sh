#!/usr/bin/env bash
# Builds the worker and Rocq's plugins for one build of docs/design.md:
#   scripts/build.sh full     wasm64 + JSPI
#   scripts/build.sh compat   wasm32 + CPS stack (waits for ocaml-emcc to
#                             support --cps-stack with --dynlink)
# into out/<build>/: rocq_web.js (rocq compile/repl), lsp_worker.js (coq-lsp),
# their .wasm, plugins/<findlib name>.wasm, and web/ for a Web Worker
# (lsp_worker.js and the files it reads)
set -euo pipefail
cd "$(dirname "$0")/.."

build=${1:-full}
# emscripten's C stack: ocaml-emcc's default unless ROCQ_WEB_STACK
stack=(${ROCQ_WEB_STACK:+--stack-size "$ROCQ_WEB_STACK"})
case $build in
  full) flags=(--target wasm64) link=(--jspi "${stack[@]}") ;;
  compat)
    flags=(--target wasm32) link=(--cps-stack "${stack[@]}")
    if [ -z "${ROCQ_WEB_COMPAT:-}" ]; then
      echo "compat: needs --cps-stack with --dynlink in ocaml-emcc (ROCQ_WEB_COMPAT=1 to try)" >&2
      exit 1
    fi ;;
  *) echo "usage: $0 full|compat" >&2; exit 2 ;;
esac

OCAML_EMCC=${OCAML_EMCC:-ocaml-emcc}
out=out/$build
mkdir -p "$out/plugins"
# --node-fs: run under node with the host files (Rocq's, findlib's), until
# the browser worker has its own file system.
scripts/vendor.sh
"$OCAML_EMCC" "${flags[@]}" build "$out/rocq_web.js" --exe worker/rocq_web "${link[@]}" --node-fs
# coq-lsp's server, its messages from web/rocq-web-io.js
"$OCAML_EMCC" "${flags[@]}" build "$out/lsp_worker.js" --exe worker/lsp_worker "${link[@]}" --node-fs \
  -- --pre-js web/rocq-web-io.js

# The same for a Web Worker: Rocq's files in emscripten's file system
# (web/rocq-web-fs.js, scripts/assets.mjs)
"$OCAML_EMCC" "${flags[@]}" build "$out/web/lsp_worker.js" --exe worker/lsp_worker "${link[@]}" \
  -- --pre-js web/rocq-web-io.js --pre-js web/rocq-web-fs.js -sENVIRONMENT=web,worker -sFORCE_FILESYSTEM=1

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
linked=$(ocamlfind query -r -format '%p' coq-lsp.controller js_of_ocaml unix findlib ocaml-emcc.dynlink | sort -u)
failed=()
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
  if [ ! -f "$cma" ]; then failed+=("$pkg (no $(basename "$cma"): scripts/byte-plugins.sh)"); continue; fi
  [ -f "$out/plugins/$pkg.wasm" ] && [ "$out/plugins/$pkg.wasm" -nt "$cma" ] && [ "$out/plugins/$pkg.wasm" -nt "$out/lsp_worker.wasm" ] && continue
  "$OCAML_EMCC" "${flags[@]}" plugin "$cma" -o "$out/plugins/$pkg.wasm" --main "$out/lsp_worker.js" || failed+=("$pkg")
done
for f in "${failed[@]}"; do echo "plugin not built: $f" >&2; done

node scripts/assets.mjs "$build" "$out/web"
