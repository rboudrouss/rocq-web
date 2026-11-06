#!/usr/bin/env bash
# The bytecode archives (.cma) of the plugins that opam installs native
# only: coq_makefile builds a plugin's .cma only with `make byte`, which an
# opam package does not run. For each plugin declared by the switch's
# libraries (Declare ML Module) whose archive is missing, the sources of
# its opam package (_src/byte/PKG) are compiled to bytecode, plugins only
# (coq_makefile's bytefiles, on each of its _CoqProject files), and the
# archive goes to _build/byte-plugins/DIR/, DIR its findlib directory's
# name, where scripts/build.sh finds it.
#   . scripts/env.sh && scripts/byte-plugins.sh
set -euo pipefail
cd "$(dirname "$0")/.."

dest=_build/byte-plugins
mkdir -p "$dest" _src/byte
plugins=$(grep -rhoE 'Declare ML Module "[^"]+"' "$OPAM_SWITCH_PREFIX/lib/coq" | sed 's/.*"\(.*\)"/\1/' | sort -u)
for pkg in $(ocamlfind query -r -format '%p' $plugins | awk '!seen[$0]++'); do
  cma=$(ocamlfind query -predicates byte -format '%d/%a' "$pkg")
  case $cma in */ | "" | */fake.cma) continue ;; esac
  dir=$(basename "$(dirname "$cma")")
  [ -f "$cma" ] || [ -f "$dest/$dir/$(basename "$cma")" ] && continue
  # the opam package that installed the directory
  opam=$(grep -l "\"lib/$dir/" "$OPAM_SWITCH_PREFIX"/.opam-switch/install/*.changes | head -1)
  name=$(basename "$opam" .changes)
  src=_src/byte/$name
  echo "$pkg: $(basename "$cma") from $name"
  [ -d "$src" ] || opam source "$name" --dir "$src" >/dev/null
  if [ -z "$(find "$src" -name "$(basename "$cma")" | head -1)" ]; then
    for project in "$src"/_CoqProject* "$src"/_RocqProject*; do
      [ -f "$project" ] && grep -qE '\.(mllib|mlpack)' "$project" || continue
      (cd "$src" && rocq makefile -f "$(basename "$project")" -o Makefile.rocq-web-byte >/dev/null &&
        nice -n19 make -f Makefile.rocq-web-byte bytefiles) || true
    done
  fi
  built=$(find "$src" -name "$(basename "$cma")" | head -1)
  if [ -z "$built" ]; then echo "$pkg: no $(basename "$cma") built" >&2; continue; fi
  mkdir -p "$dest/$dir"
  cp "$built" "$dest/$dir/"
done
