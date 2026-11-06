From HB Require Import structures.
From mathcomp Require Import ssreflect ssrfun ssrbool eqtype ssrnat seq.

Lemma addn0' (n : nat) : n + 0 = n.
Proof. by rewrite addn0. Qed.

Lemma size_rev' (T : Type) (s : seq T) : size (rev s) = size s.
Proof. by rewrite size_rev. Qed.

HB.mixin Record IsPointed T := { point : T }.
HB.structure Definition Pointed := { T of IsPointed T }.
HB.instance Definition _ := IsPointed.Build nat 0.
Check (point : nat).
