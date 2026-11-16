(* Prints the libraries each .vo requires, read from its summary segment.
   For each .vo path on stdin it prints a line "FILE NAME DEP...", with the
   libraries by logical name, in the order Rocq loads them.
   scripts/assets.mjs builds and runs it.

   The record below matches the first two fields of the summary in Rocq's
   vernac/library.ml. *)
type summary = { md_name : string list; md_deps : (string list * Obj.t) array }

let segment : summary ObjFile.id = ObjFile.make_id "summary"

(* A DirPath.t holds its identifiers last first *)
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
