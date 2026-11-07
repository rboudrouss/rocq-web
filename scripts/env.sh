# Source me: emsdk, the rocq-web opam switch, node >= 24 (wasm64, JSPI).
. "${EMSDK:-$HOME/tools/emsdk}/emsdk_env.sh" >/dev/null 2>&1
eval "$(opam env --switch=rocq-web --set-switch)"
NODE_DIR=${NODE_DIR:-$(ls -d "$HOME"/.nvm/versions/node/v2[4-9]*/bin 2>/dev/null | tail -1)}
if [ -n "$NODE_DIR" ]; then PATH=$NODE_DIR:$PATH; fi
