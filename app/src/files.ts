// The user's files, in the browser's local storage: "rocq-web:NAME.v" for
// each file, "rocq-web:active" for the one open in the editor.
const prefix = "rocq-web:";
const activeKey = "rocq-web:active";

export const example = `(* Rocq in the browser *)
Theorem plus_comm : forall n m : nat, n + m = m + n.
Proof.
  intros n m. induction n as [|n IH]; simpl.
  - rewrite <- plus_n_O. reflexivity.
  - rewrite IH. apply plus_n_Sm.
Qed.

(* Libraries are fetched when required *)
From Stdlib Require Import Lia.
Lemma lia_example (x y : nat) : x + 2 * y <= 3 * y + x.
Proof. lia. Qed.

From Ltac2 Require Import Ltac2.
Ltac2 Eval List.length [1; 2; 3].
`;

// A file name: a Rocq module name and .v
export const validName = (name: string) => /^[A-Za-z_][A-Za-z0-9_']*\.v$/.test(name);

export function listFiles(): string[] {
  const names: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith(prefix) && k.endsWith(".v")) names.push(k.slice(prefix.length));
  }
  if (names.length === 0) {
    writeFile("scratch.v", example);
    names.push("scratch.v");
  }
  return names.sort();
}

export const readFile = (name: string) => localStorage.getItem(prefix + name) ?? "";
export const writeFile = (name: string, text: string) => localStorage.setItem(prefix + name, text);
export const removeFile = (name: string) => localStorage.removeItem(prefix + name);

export function activeFile(files: string[]) {
  const a = localStorage.getItem(activeKey);
  return a && files.includes(a) ? a : files[0];
}
export const setActiveFile = (name: string) => localStorage.setItem(activeKey, name);
