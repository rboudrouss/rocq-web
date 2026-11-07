// The user's files, in the browser's local storage: "rocq-web:PATH" for
// each file (NAME.v, DIR/NAME.v, a project file), and the lists of the
// folders (those without files too) and of the workspaces, and the file
// open in the editor.
const prefix = "rocq-web:";
const activeKey = "rocq-web:active";
const foldersKey = "rocq-web:folders";
const workspacesKey = "rocq-web:workspaces";

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
const storage: Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem"> = embedded
  ? new Memory()
  : localStorage;

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

// Names: a folder's (letters, digits, _ ' - .), a Rocq file's (a module
// name and .v), or a project file (_RocqProject, _CoqProject: Rocq's
// options for its folder)
export const projectFile = "_RocqProject";
const folderPart = "[A-Za-z0-9_][A-Za-z0-9_'.-]*";
const moduleName = "[A-Za-z_][A-Za-z0-9_']*";
const fileRe = new RegExp(`^(${folderPart}/)*(${moduleName}\\.v|_RocqProject|_CoqProject)$`);
const folderRe = new RegExp(`^${folderPart}(/${folderPart})*$`);
export const validName = (name: string) => fileRe.test(name);
export const validFolder = (path: string) => folderRe.test(path);
export const isRocq = (name: string) => name.endsWith(".v");
export const isProject = (name: string) => /(^|\/)_(Rocq|Coq)Project$/.test(name);

// "A/B/C.v" -> "A/B", "C.v" -> ""
export const dirname = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
export const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
// Whether [path] is [dir] or under it ("" is the root, above everything)
export const within = (path: string, dir: string) => dir === "" || path === dir || path.startsWith(dir + "/");

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
  return a && files.includes(a) ? a : (files.find(isRocq) ?? files[0]);
}
export const setActiveFile = (name: string) => storage.setItem(activeKey, name);

const readList = (key: string): string[] => {
  try {
    const l = JSON.parse(storage.getItem(key) ?? "[]");
    return Array.isArray(l) ? l.filter((x): x is string => typeof x === "string" && validFolder(x)) : [];
  } catch {
    return [];
  }
};
const writeList = (key: string, list: string[]) => storage.setItem(key, JSON.stringify([...new Set(list)].sort()));

// The folders created without files yet (those of the files are implicit)
export const listFolders = () => readList(foldersKey);
export const setFolders = (list: string[]) => writeList(foldersKey, list);

// The folders that are workspaces (docs/design.md, "Workspaces")
export const listWorkspaces = () => readList(workspacesKey);
export const setWorkspaces = (list: string[]) => writeList(workspacesKey, list);
