(** Rocq's [Declare ML Module], resolved to plugins compiled by
    [ocaml-emcc plugin]. *)

val install : dir:string -> unit
(** [install ~dir] makes Rocq load the plugin of a findlib package [p]
    from [dir/p.wasm]. Packages without such a file are taken as linked
    in the program. *)
