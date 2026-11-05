#!/usr/bin/env bash
# Checks out the submodules and applies patches/<submodule>/*.patch to them
# (once: a patch already applied is skipped).
set -euo pipefail
cd "$(dirname "$0")/.."
git submodule update --init
for dir in patches/*/; do
  sub=vendor/$(basename "$dir")
  for p in "$dir"*.patch; do
    if git -C "$sub" apply --reverse --check "$PWD/$p" 2>/dev/null; then continue; fi
    git -C "$sub" apply "$PWD/$p"
    echo "applied $p"
  done
done
