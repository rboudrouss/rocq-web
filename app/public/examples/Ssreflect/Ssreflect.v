(* The Mathematical Components library and its proof language, SSReflect
   (downloaded the first time it is required) *)
Set Warnings "-notation-overridden".
From mathcomp Require Import boot.

Lemma sum_odd n : \sum_(i < n) (2 * i + 1) = n ^ 2.
Proof.
  elim: n => [|n IH]; first by rewrite big_ord0.
  rewrite big_ord_recr /= IH.
  (* n ^ 2 + (2 * n + 1) = n.+1 ^ 2 *)
  by rewrite -[n.+1]addn1 sqrnD muln1 exp1n -addnA [1 + _]addnC.
Qed.

Lemma leq_double m n : (m.*2 <= n.*2) = (m <= n).
Proof. by rewrite leq_double. Qed.
