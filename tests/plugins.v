(* Each of Rocq's plugins the worker loads as a wasm side module *)
From Corelib Require Import ssreflect ssrbool.
From Ltac2 Require Import Ltac2.

Ltac2 rec count n := match n with 0 => 0 | _ => Int.add 1 (count (Int.sub n 1)) end.
Ltac2 Eval count 10000.

Set Default Proof Mode "Classic".

Lemma ssr_test (b : bool) : b || ~~ b.
Proof. by case: b. Qed.

Lemma fo_test (P Q : nat -> Prop) : (forall x, P x -> Q x) -> (exists x, P x) -> exists x, Q x.
Proof. firstorder. Qed.

Lemma cong_test (f : nat -> nat) a b : a = b -> f (f a) = f (f b).
Proof. congruence. Qed.

Fixpoint fib n := match n with 0 => 0 | S m => match m with 0 => 1 | S k => fib m + fib k end end.
Eval vm_compute in fib 22.
Eval lazy in fib 15.
