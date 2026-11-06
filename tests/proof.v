Theorem plus_comm_test : forall n m : nat, n + m = m + n.
Proof.
  intros n m. induction n as [|n IH]; simpl.
  - rewrite <- plus_n_O. reflexivity.
  - rewrite IH. apply plus_n_Sm.
Qed.

Lemma oops : 1 = 2.
Proof. reflexivity. Qed.
