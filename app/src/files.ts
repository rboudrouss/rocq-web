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

// Files of a folder on disk (Chrome's File System Access API), for this
// session: their edits are written back
type DirectoryHandle = { values: () => AsyncIterable<{ kind: string; name: string; getFile?: () => Promise<File> }> };
type FileHandle = { kind: "file"; name: string; getFile: () => Promise<File>; createWritable: () => Promise<{ write: (t: string) => Promise<void>; close: () => Promise<void> }> };
const onDisk = new Map<string, FileHandle>();

export const canOpenFolder = () => "showDirectoryPicker" in window;
export const isOnDisk = (name: string) => onDisk.has(name);

// The .v files of a folder the user picks (not its subfolders): their names
export async function openFolder(): Promise<string[]> {
  const dir = (await (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirectoryHandle> }).showDirectoryPicker({
    mode: "readwrite",
  })) as DirectoryHandle;
  const names: string[] = [];
  for await (const h of dir.values()) {
    if (h.kind !== "file" || !validName(h.name)) continue;
    const handle = h as unknown as FileHandle;
    writeFile(h.name, await (await handle.getFile()).text());
    onDisk.set(h.name, handle);
    names.push(h.name);
  }
  return names.sort();
}

// Writes a file back to disk, if it came from there
export async function saveToDisk(name: string, text: string) {
  const h = onDisk.get(name);
  if (!h) return;
  const w = await h.createWritable();
  await w.write(text);
  await w.close();
}
