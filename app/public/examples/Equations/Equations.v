(* The Equations plugin: functions by dependent pattern matching and
   well-founded recursion, with their equations and elimination principle *)
From Equations Require Import Equations.
From Stdlib Require Import List Lia.
Import ListNotations.

Equations interleave {A} (l l' : list A) : list A by wf (length l + length l') lt :=
  interleave [] l' := l';
  interleave (x :: l) l' := x :: interleave l' l.
Next Obligation. lia. Qed.

Compute interleave [1; 3; 5] [2; 4; 6].

Lemma interleave_length {A} (l l' : list A) :
  length (interleave l l') = length l + length l'.
Proof.
  funelim (interleave l l'); simp interleave; simpl.
  - reflexivity.
  - rewrite H. lia.
Qed.
