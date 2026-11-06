(* Lists: polymorphic functions and proofs about them *)
From Stdlib Require Import List.
Import ListNotations.

Fixpoint rev' {A : Type} (l : list A) : list A :=
  match l with
  | [] => []
  | x :: l' => rev' l' ++ [x]
  end.

Compute rev' [1; 2; 3].

Lemma rev'_app {A : Type} (l1 l2 : list A) :
  rev' (l1 ++ l2) = rev' l2 ++ rev' l1.
Proof.
  induction l1 as [| x l1 IH]; simpl.
  - rewrite app_nil_r. reflexivity.
  - rewrite IH. rewrite app_assoc. reflexivity.
Qed.

Theorem rev'_involutive {A : Type} (l : list A) : rev' (rev' l) = l.
Proof.
  induction l as [| x l IH]; simpl.
  - reflexivity.
  - rewrite rev'_app. simpl. rewrite IH. reflexivity.
Qed.

(* The same function as the library's *)
Lemma rev'_rev {A : Type} (l : list A) : rev' l = rev l.
Proof. induction l; simpl; congruence. Qed.
