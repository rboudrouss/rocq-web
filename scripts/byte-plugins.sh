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

# the packages whose plugins need their build first: generated code
# (MetaRocq's, extracted from its theories), a configure script
prebuild() {
  case $1 in
    rocq-metarocq-template) bash ./configure.sh && make -C template-rocq ;;
    rocq-relation-algebra) ./configure --enable-ssr --enable-aac && make ;;
    *) return 1 ;;
  esac
}

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
  # (the version installed: opam source may take a newer one)
  version=$(basename "$(ls -d "$OPAM_SWITCH_PREFIX/.opam-switch/packages/$name".* | head -1)")
  [ -d "$src" ] || opam source "$version" --dir "$src" >/dev/null
  if [ -z "$(find "$src" -name "$(basename "$cma")" | head -1)" ] &&
    (cd "$src" && prebuild "$name" > /dev/null); then
    # then the plugins of each makefile rocq makefile wrote
    grep -rl --include='*akefile*' '^bytefiles:' "$src" | while read -r mk; do
      (cd "$(dirname "$mk")" && nice -n19 make -f "$(basename "$mk")" bytefiles > /dev/null) || true
    done
  fi
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
