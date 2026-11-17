# coq-lsp for Rocq 9.2, which opam does not have, with patches/ (see each
# patch). ocaml-emcc builds its OCaml libraries for the target from these
# sources, into the sysroot's findlib directory, before the programs.
SOURCE=url:https://github.com/ejgallego/rocq-lsp/archive/f49d7b391c8dc6599a00d126d7bfedc9efbdc2e7.tar.gz
SHA256=4201b900bbc1fcead5625bbcd0f933457c2db8b3b2a552238b70d8a07d3f47b1
PATCH_OCAML=1
