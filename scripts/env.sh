# Source me: emsdk, the rocq-web opam switch, node >= 24 (wasm64, JSPI).
. "${EMSDK:-$HOME/tools/emsdk}/emsdk_env.sh" >/dev/null 2>&1
eval "$(opam env --switch=rocq-web --set-switch)"
# c_of_ocaml, built apart (ocaml-emcc's README) in ~/C_of_ocaml
c_of_ocaml=$HOME/C_of_ocaml/_build/default/compiler/bin-c_of_ocaml/c_of_ocaml.exe
if [ -z "${OCAML_EMCC_C_OF_OCAML:-}" ] && [ -x "$c_of_ocaml" ]; then export OCAML_EMCC_C_OF_OCAML=$c_of_ocaml; fi
unset c_of_ocaml
NODE_DIR=${NODE_DIR:-$(ls -d "$HOME"/.nvm/versions/node/v2[4-9]*/bin 2>/dev/null | tail -1)}
if [ -n "$NODE_DIR" ]; then PATH=$NODE_DIR:$PATH; fi
