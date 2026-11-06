(* Rocq's commands which the browser needs help for (Timeout: no
   signals; Extraction: a file written for the page). tests/page.mjs
   checks it without problems:
     node tests/page.mjs tests/support.v *)
Fail Timeout 1 Eval compute in Nat.even (Nat.pow 3 13).
Goal True.
Timeout 5 exact I.
Qed.
From Stdlib Require Extraction.
Definition double (n : nat) := n + n.
Extraction "double.ml" double.
