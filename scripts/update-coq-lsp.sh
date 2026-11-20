#!/usr/bin/env bash
# Points coq-lsp's recipe (emcc-recipes/coq-lsp/recipe.sh) at the latest
# commit of its v9.2 branch, with that archive's SHA256. Prints changed=true
# and commit=SHA when it moved, changed=false otherwise (for $GITHUB_OUTPUT).
set -euo pipefail
repo=https://github.com/rocq-community/rocq-lsp
branch=v9.2
recipe=$(dirname "$0")/../emcc-recipes/coq-lsp/recipe.sh

current=$(sed -n 's|^SOURCE=url:.*/archive/\([0-9a-f]*\)\.tar\.gz$|\1|p' "$recipe")
latest=$(git ls-remote "$repo.git" "refs/heads/$branch" | cut -f1)
[ -n "$current" ] && [ -n "$latest" ]
if [ "$current" = "$latest" ]; then
  echo changed=false
  exit 0
fi
sha256=$(curl -fsSL "$repo/archive/$latest.tar.gz" | sha256sum | cut -d' ' -f1)
sed -i -e "s|^SOURCE=url:.*|SOURCE=url:$repo/archive/$latest.tar.gz|" \
  -e "s|^SHA256=.*|SHA256=$sha256|" "$recipe"
echo changed=true
echo "commit=$latest"
