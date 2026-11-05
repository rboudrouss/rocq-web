let debug = Sys.getenv_opt "ROCQ_WEB_DEBUG" <> None

let load_package dir lib =
  if not (Findlib.is_recorded_package lib) then begin
    let file = Filename.concat dir (lib ^ ".wasm") in
    if Sys.file_exists file then begin
      if debug then Printf.eprintf "rocq-web: loading %s\n%!" file;
      Emcc_dynlink.loadfile file
    end
    else if debug then Printf.eprintf "rocq-web: %s linked in\n%!" lib;
    Findlib.record_package Findlib.Record_load lib
  end

let load_packages ~dir pkgs =
  let preds = Findlib.recorded_predicates () in
  List.iter (load_package dir) (Findlib.package_deep_ancestors preds pkgs)

let load_module file =
  CErrors.user_err Pp.(str "Cannot load " ++ str file ++ str " (no native compiler).")

let install ~dir =
  Mltop.set_top
    { load_plugin = (fun spec -> load_package dir (Mltop.PluginSpec.to_package spec));
      load_module;
      add_dir = (fun _ -> ());
      ml_loop = (fun ?init_file:_ () -> ()) }
