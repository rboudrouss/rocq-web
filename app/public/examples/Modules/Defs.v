(* Definitions which Proofs.v requires. Each file is a module of the
   workspace, and Require Import Defs. in Proofs.v compiles this one
   first. *)
Inductive tree : Type :=
| Leaf : tree
| Node : tree -> nat -> tree -> tree.

Fixpoint size (t : tree) : nat :=
  match t with
  | Leaf => 0
  | Node l _ r => size l + 1 + size r
  end.

Fixpoint mirror (t : tree) : tree :=
  match t with
  | Leaf => Leaf
  | Node l x r => Node (mirror r) x (mirror l)
  end.
