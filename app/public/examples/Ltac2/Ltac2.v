(* Ltac2, Rocq's typed tactic language *)
From Ltac2 Require Import Ltac2.

(* A tactic splitting conjunctions in the goal and the hypotheses *)
Ltac2 rec split_all () :=
  repeat (match! goal with
          | [ h : _ /\ _ |- _ ] => let h := Control.hyp h in destruct $h
          | [ |- _ /\ _ ] => split
          end).

Goal forall P Q R : Prop, P /\ (Q /\ R) -> (R /\ P) /\ Q.
Proof.
  intros P Q R H.
  split_all ().
  all: assumption.
Qed.

Ltac2 Eval List.map (fun x => Int.mul x x) [1; 2; 3].
