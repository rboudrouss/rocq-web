// The user's files, in the browser's local storage: "rocq-web:PATH" for
// each file (NAME.v, DIR/NAME.v, _RocqProject), "rocq-web:active" for the
// one open in the editor.
const prefix = "rocq-web:";

// Embedded in another page (?embed): its files in memory only, for the
// page's lifetime, not those of the user's workspace
export const embedded = new URLSearchParams(location.search).has("embed");
class Memory {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}
const storage = embedded ? new Memory() : localStorage;
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

// A file name: Rocq module names (its directories, then its own) and .v,
// or the project's file
export const validName = (name: string) =>
  name === projectFile || /^([A-Za-z_][A-Za-z0-9_']*\/)*[A-Za-z_][A-Za-z0-9_']*\.v$/.test(name);
export const projectFile = "_RocqProject";
export const isRocq = (name: string) => name.endsWith(".v");

export function listFiles(): string[] {
  const names: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)!;
    if (k.startsWith(prefix) && validName(k.slice(prefix.length))) names.push(k.slice(prefix.length));
  }
  if (!names.some(isRocq)) {
    writeFile("scratch.v", example);
    names.push("scratch.v");
  }
  return names.sort();
}

export const readFile = (name: string) => storage.getItem(prefix + name) ?? "";
export const writeFile = (name: string, text: string) => storage.setItem(prefix + name, text);
export const removeFile = (name: string) => storage.removeItem(prefix + name);

export function activeFile(files: string[]) {
  const a = storage.getItem(activeKey);
  return a && files.includes(a) ? a : files[0];
}
export const setActiveFile = (name: string) => storage.setItem(activeKey, name);

// Files of a folder on disk (Chrome's File System Access API), for this
// session: their edits are written back
type DirectoryHandle = { kind: "directory"; name: string; values: () => AsyncIterable<DirectoryHandle | FileHandle> };
type FileHandle = { kind: "file"; name: string; getFile: () => Promise<File>; createWritable: () => Promise<{ write: (t: string) => Promise<void>; close: () => Promise<void> }> };
const onDisk = new Map<string, FileHandle>();

export const canOpenFolder = () => "showDirectoryPicker" in window;
export const isOnDisk = (name: string) => onDisk.has(name);

// The .v files of a folder the user picks and of its subfolders (not
// hidden ones, nor _build), and its _RocqProject: their paths
export async function openFolder(): Promise<string[]> {
  const dir = (await (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirectoryHandle> }).showDirectoryPicker({
    mode: "readwrite",
  })) as DirectoryHandle;
  const names: string[] = [];
  const walk = async (d: DirectoryHandle, at: string) => {
    for await (const h of d.values()) {
      const path = at + h.name;
      if (h.kind === "directory") {
        if (!h.name.startsWith(".") && h.name !== "_build") await walk(h, path + "/");
      } else if (validName(path)) {
        writeFile(path, await (await h.getFile()).text());
        onDisk.set(path, h);
        names.push(path);
      }
    }
  };
  await walk(dir, "");
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
