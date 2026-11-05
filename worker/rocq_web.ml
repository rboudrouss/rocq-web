(* Entry point: [rocq_web compile ARGS] is [rocq compile ARGS],
   [rocq_web repl ARGS] is [rocq repl ARGS]. *)

let usage () =
  prerr_endline "usage: rocq_web (compile|repl) [ARGS]";
  exit 2

let () =
  let dir =
    match Sys.getenv_opt "ROCQ_WEB_PLUGINS" with
    | Some d -> d
    | None -> Filename.concat (Filename.dirname Sys.executable_name) "plugins"
  in
  Rocq_web_plugins.Plugins.install ~dir;
  match List.tl (Array.to_list Sys.argv) with
  | "compile" :: args -> Coqc.main args
  | "repl" :: args -> Coqtop.(start_coq coqtop_toplevel args)
  | _ -> usage ()
