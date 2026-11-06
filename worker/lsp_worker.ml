(* coq-lsp's server in a Web Worker, after coq-lsp's lsp-server/jsoo, with
   its loop in [main] rather than in callbacks: with JSPI, the deep
   recursions of Rocq go on new stacks only from the program's main code.
   It waits for messages by suspending (lsp_io.c). *)

module Lsp = Fleche_lsp
open Js_of_ocaml
open Controller

let wait = Lsp_io.wait

let js = Js.Unsafe.get Js.Unsafe.global "rocqWeb"

(* The next queued message, if any *)
let pop () : string option =
  Js.Opt.to_option (Js.Unsafe.meth_call js "pop" [||]) |> Stdlib.Option.map Js.to_string

let post_message (msg : Lsp.Base.Message.t) =
  let s = Yojson.Safe.to_string (Lsp.Base.Message.to_yojson msg) in
  ignore (Js.Unsafe.meth_call js "post" [| Js.Unsafe.inject (Js.string s) |])

let parse s =
  match Yojson.Safe.from_string s with
  | json -> Lsp.Base.Message.of_yojson json
  | exception Yojson.Json_error e -> Error e

module CB = Lsp_core.CB (struct
  let ofn n = Lsp.Base.Message.notification n |> post_message
end)

let io = CB.cb

let error message = Fleche.Io.(Report.message_ ~io ~lvl:Level.Error ~message)

(* The messages queued meanwhile, to the controller's queue *)
let rec drain () =
  match pop () with
  | None -> ()
  | Some s ->
    (match parse s with
     | Ok msg -> Lsp_core.enqueue_message msg
     | Error e -> error ("Error in JSON RPC Message Parsing: " ^ e));
    drain ()

(* The JavaScript event loop gets to run (and queue messages) at least
   every [slice] seconds of work *)
let slice = 0.05

let rec process_queue ~last ~state =
  drain ();
  match Lsp_core.dispatch_or_resume_check ~io ~ofn:post_message ~state with
  | None -> ()
  | Some (Yield state) ->
    ignore (wait 100.);
    process_queue ~last:(Unix.gettimeofday ()) ~state
  | Some (Cont state) ->
    let now = Unix.gettimeofday () in
    if now -. last > slice then (
      ignore (wait 0.);
      process_queue ~last:(Unix.gettimeofday ()) ~state)
    else process_queue ~last ~state

let rec init_loop ~root_state ~cmdline ~debug =
  let rec next () =
    match pop () with
    | Some s -> s
    | None -> ignore (wait 1000.); next ()
  in
  match parse (next ()) with
  | Error e ->
    error ("Error in JSON RPC Message Parsing: " ^ e);
    init_loop ~root_state ~cmdline ~debug
  | Ok msg -> (
    match Lsp_core.lsp_init_process ~ofn:post_message ~io ~cmdline ~debug msg with
    | Lsp_core.Init_effect.Exit -> ()
    | Lsp_core.Init_effect.Loop -> init_loop ~root_state ~cmdline ~debug
    | Lsp_core.Init_effect.Success workspaces ->
      let default_workspace = Coq.Workspace.default ~debug ~cmdline in
      let state =
        { Lsp_core.State.root_state; cmdline; workspaces; default_workspace }
      in
      process_queue ~last:(Unix.gettimeofday ()) ~state)

let getenv v d = Stdlib.Option.value (Sys.getenv_opt v) ~default:d

(* Rocq's reductions (cbv, compute, unification) never check for
   interrupts: one still pending half a second after the page asked for it
   (Control.interrupt, worker/plugins/interrupt.c) is raised by a Memprof
   callback, at an allocation, if coq-lsp runs a command then (an
   exception from anywhere in Rocq, which coq-lsp's interrupts of native
   Rocq through memprof-limits also are) *)
let interrupt_reductions () =
  let pending = ref None in
  let check _ =
    (if !Control.interrupt && !Coq.Limits.interruptible then
       let now = Unix.gettimeofday () in
       match !pending with
       | None -> pending := Some now
       | Some t when now -. t > 0.5 ->
         pending := None;
         Control.interrupt := false;
         raise Sys.Break
       | Some _ -> ()
     else pending := None);
    None
  in
  let tracker = { Gc.Memprof.null_tracker with alloc_minor = check; alloc_major = check } in
  ignore (Gc.Memprof.start ~callstack_size:0 ~sampling_rate:1e-5 tracker)

let main () =
  Sys.interactive := false;
  Rocq_web_plugins.Plugins.interrupts ();
  interrupt_reductions ();
  Coq.Limits.(select Coq);
  Coq.Limits.start ();
  Fleche.Io.CallBack.set io;
  let plugins = getenv "ROCQ_WEB_PLUGINS" "/plugins" in
  let coqlib = getenv "ROCQLIB" "/coqlib" in
  let debug = Sys.getenv_opt "ROCQ_WEB_DEBUG" <> None in
  let root_state =
    (* As coq-lsp's Coq.Loader.plugin_handler: the plugins of Rocq go
       through serlib's (coq-lsp.serlib.<plugin>, which requires the
       plugin), without its warning for the other packages, which Rocq
       also loads (the libraries the plugins need: elpi...) *)
    let load_plugin spec =
      let pkg = Mltop.PluginSpec.to_package spec in
      let serlib =
        match String.split_on_char '.' pkg with
        | [ "rocq-runtime"; "plugins"; name ] -> Some ("coq-lsp.serlib." ^ name)
        | _ -> None
      in
      let pkg =
        match serlib with
        | Some s when Sys.file_exists (Filename.concat plugins (s ^ ".wasm")) -> s
        | _ -> pkg
      in
      Rocq_web_plugins.Plugins.load_packages ~dir:plugins [ pkg ]
    in
    let load_module file = CErrors.user_err Pp.(str "Cannot load " ++ str file) in
    Coq.Init.(
      coq_init
        { debug; record_comments = false; load_module; load_plugin; vm = true; warnings = None })
  in
  let loadpath unix_path coq_path implicit =
    Loadpath.{ unix_path; coq_path; installed = true; implicit; recursive = true }
  in
  let cmdline =
    Coq.Workspace.CmdLine.
      { coqlib
      ; findlib_config = Sys.getenv_opt "OCAMLFIND_CONF"
      ; ocamlpath = []
      ; vo_load_path =
          [ loadpath (Filename.concat coqlib "theories")
              Names.(DirPath.make [ Id.of_string "Corelib" ]) true
          ; loadpath (Filename.concat coqlib "user-contrib") Names.DirPath.empty false ]
      ; require_libraries = [ (None, "Corelib.Init.Prelude") ]
      ; args = [ "-noinit" ]
      }
  in
  init_loop ~root_state ~cmdline ~debug;
  (* After [exit]: the JavaScript side still reads its input *)
  exit 0

let () = main ()
