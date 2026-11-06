(* The plugins of the switch's packages, one use each *)
From Equations Require Import Equations.
Equations half (n : nat) : nat :=
  half 0 := 0; half 1 := 0; half (S (S n)) := S (half n).
Lemma half_4 : half 4 = 2. Proof. reflexivity. Qed.

From Stdlib Require Import PeanoNat.
From AAC_tactics Require Import AAC Instances.
Import Instances.Peano.
Lemma aac_example (a b c : nat) : a + (b + c) = c + (b + a).
Proof. aac_reflexivity. Qed.

From Hammer Require Import Tactics.
Lemma sauto_example (A B : Prop) : A /\ B -> B /\ A.
Proof. sauto. Qed.

From MetaRocq.Template Require Import All.
MetaRocq Quote Definition quoted_one := 1.

From Bignums Require Import BigN.
Check (BigN.add 1 2)%bigN.

From RelationAlgebra Require Import kat_tac.

From Coinduction Require Import all.

From iris.proofmode Require Import proofmode.
Lemma iris_example {PROP : bi} (P Q : PROP) : P ∗ Q ⊢ Q ∗ P.
Proof. iIntros "[HP HQ]". iFrame. Qed.

From Interval Require Import Tactic.
From Stdlib Require Import Reals.
Open Scope R_scope.
Lemma interval_example : 3 <= PI <= 4.
Proof. interval. Qed.
