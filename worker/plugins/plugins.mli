(** Rocq's plugins, compiled by [ocaml-emcc plugin]: the plugin of a
    findlib package [p] is the side module [dir/p.wasm]. *)

val load_packages : dir:string -> string list -> unit
(** [load_packages ~dir pkgs] loads [pkgs] and the packages they need
    (findlib's [requires]), unless already loaded. A package without a
    side module is taken as linked in the program. *)

val install : dir:string -> unit
(** [install ~dir] makes [Declare ML Module] load plugins from [dir]. *)
