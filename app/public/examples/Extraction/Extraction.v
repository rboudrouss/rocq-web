(* Extraction writes OCaml from Rocq's definitions. The files appear in
   the Files panel (Written by Rocq), to read or download. *)
From Stdlib Require Import Extraction List.
Import ListNotations.

Fixpoint insert (x : nat) (l : list nat) : list nat :=
  match l with
  | [] => [x]
  | y :: l' => if Nat.leb x y then x :: l else y :: insert x l'
  end.

Definition sort (l : list nat) : list nat := fold_right insert [] l.

Compute sort [3; 1; 2].

Extraction Language OCaml.
Extraction "sort.ml" sort.
