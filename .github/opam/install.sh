#!/usr/bin/env bash
# The opam switch rocq-web of docs/building.md, for the deploy workflow.
# OCaml 5.4.1, Rocq 9.2.0, the packages of .github/opam/packages, ocaml-emcc
# and the dependencies of c_of_ocaml (built from a clone by the workflow).
# Run again on a partial switch restored from the cache, it installs what is
# missing.
set -euo pipefail
export OPAMYES=1 OPAMCONFIRMLEVEL=unsafe-yes OPAMJOBS=${OPAMJOBS:-$(nproc)}
S=--switch=rocq-web
dir=$(cd "$(dirname "$0")" && pwd)

[ -f ~/.opam/config ] || opam init --bare --disable-sandboxing --no-setup
if ! opam switch list --short | grep -qx rocq-web; then
  opam switch create rocq-web ocaml-base-compiler.5.4.1 \
    --repos=rocq-released=https://rocq-prover.org/opam/released,default
fi

for p in rocq-runtime rocq-core rocq-stdlib; do
  opam pin add $S --no-action $p 9.2.0
done
opam pin add $S --no-action ocaml-emcc git+https://github.com/rboudrouss/ocaml-emcc.git#main

# c_of_ocaml has no opam package. Its dependencies, from the opam file of its
# compiler (opam ignores pin-depends with --deps-only).
cofo=$(mktemp -d)
git clone -q --depth 1 https://github.com/rboudrouss/C_of_ocaml.git "$cofo"
sed -n 's/^ *\["\([^"]*\)" "\([^"]*\)"\].*/\1 \2/p' "$cofo/js_of_ocaml-compiler.opam" | sort -u |
  while read -r pkg url; do opam pin add $S --no-action "$pkg" "$url"; done
opam install $S --deps-only "$cofo/js_of_ocaml-compiler.opam"
rm -rf "$cofo"

opam install $S ocaml-emcc $(cat "$dir/packages")
opam clean --all-switches --download-cache --logs
