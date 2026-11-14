(* The libraries each .vo requires, from its summary (Rocq's
   vernac/library.ml, whose first two fields this record matches): for each
   .vo named on stdin, a line "FILE NAME DEP...", the libraries by their
   logical names, in the order Rocq loads them. Built and run by
   scripts/assets.mjs. *)
type summary = { md_name : string list; md_deps : (string list * Obj.t) array }

let segment : summary ObjFile.id = ObjFile.make_id "summary"

(* (a DirPath.t: its identifiers, last first) *)
let name l = String.concat "." (List.rev l)

let () =
  try
    while true do
      let file = input_line stdin in
      let ch = ObjFile.open_in ~file in
      let s, _ = ObjFile.marshal_in_segment ch ~segment in
      ObjFile.close_in ch;
      print_string (file ^ " " ^ name s.md_name);
      Array.iter (fun (d, _) -> print_string (" " ^ name d)) s.md_deps;
      print_newline ()
    done
  with End_of_file -> ()
