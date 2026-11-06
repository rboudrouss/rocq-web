(* A first proof: addition on the natural numbers.
   Move the cursor through a proof to see its goals on the right, and
   what each step changed (highlighted). *)

(* Rocq's prelude defines nat as
   Inductive nat : Set := O : nat | S : nat -> nat. *)
Print nat.

Fixpoint double (n : nat) : nat :=
  match n with
  | O => O
  | S n' => S (S (double n'))
  end.

Compute double 3.

(* A proof by induction on n *)
Lemma double_plus (n : nat) : double n = n + n.
Proof.
  induction n as [| n' IH].
  - (* n = 0 *)
    simpl. reflexivity.
  - (* n = S n' *)
    simpl. rewrite IH.
    (* S (S (n' + n')) = S (n' + S n') *)
    rewrite <- plus_n_Sm.
    reflexivity.
Qed.

(* Search finds the lemmas of Rocq's library. The Query tab runs it at
   the cursor without changing the file. *)
Search (_ + S _ = S (_ + _)).

(* lia proves goals of linear arithmetic *)
From Stdlib Require Import Lia.

Lemma double_le (n : nat) : n <= double n.
Proof.
  rewrite double_plus. lia.
Qed.
