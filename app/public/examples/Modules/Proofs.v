(* Proofs about the definitions of Defs.v. F12 (or Ctrl+click) on a name
   goes to its definition, in Defs.v or in Rocq's libraries. *)
From Stdlib Require Import Lia.
Require Import Defs.

Lemma size_mirror (t : tree) : size (mirror t) = size t.
Proof.
  induction t as [| l IHl x r IHr]; simpl.
  - reflexivity.
  - rewrite IHl, IHr. lia.
Qed.

Lemma mirror_mirror (t : tree) : mirror (mirror t) = t.
Proof.
  induction t as [| l IHl x r IHr]; simpl; congruence.
Qed.
