// Workspaces (docs/design.md): folders checked as Rocq projects of their
// own, each with its project file (its load path), and the root of the
// files, the files in no workspace. A workspace's project file is
// generated (its files are the modules NAME.*, NAME the folder's name) unless
// the user writes one in it (_RocqProject or _CoqProject). In the worker the
// files are under /workspace, each workspace a workspace folder of coq-lsp.
import { basename, dirname, isProject, isRocq, within } from "./storage";

export const root = "";
export const rootName = "Workspace";
export const workerDir = (dir: string) => (dir === root ? "/workspace" : `/workspace/${dir}`);
export const workerUri = (path: string) => `file:///workspace/${path}`;

// Warnings off for every workspace: Extraction writes in the workspace
const args = "-arg -w -arg -extraction-default-directory\n";

// The names of the libraries (the first part of their modules: Stdlib,
// Ltac2, mathcomp...), which a workspace's must not hide (main.tsx sets
// them from the build's packages.json before the page starts)
let libraries = new Set(["Corelib", "Stdlib", "Ltac2", "Coq", "Rocq"]);
export const setLibraries = (names: Iterable<string>) => (libraries = new Set([...libraries, ...names]));

// The logical name of a workspace: its folder's name, made a Rocq name,
// and _ after it when a library has that name (the example Ltac2/: Ltac2_)
export function logicalName(dir: string) {
  if (dir === root) return rootName;
  let n = basename(dir).replace(/[^A-Za-z0-9_']/g, "_");
  if (!/^[A-Za-z_]/.test(n)) n = `_${n}`;
  return libraries.has(n) ? `${n}_` : n;
}

export const generatedProject = (dir: string) => `-R . ${logicalName(dir)}\n${args}`;

// The workspace a path is in: the innermost workspace folder containing it
export function workspaceOf(path: string, workspaces: string[]) {
  let best = root;
  for (const w of workspaces) if (within(path, w) && w.length > best.length) best = w;
  return best;
}

// Whether a folder can become a workspace: not the root, not in a
// workspace nor containing one (workspaces are disjoint)
export const canBeWorkspace = (folder: string, workspaces: string[]) =>
  folder !== root && !workspaces.some((w) => within(folder, w) || within(w, folder));

// The project file a workspace's user wrote, if any
export function customProject(dir: string, files: string[]) {
  return files.find((f) => isProject(f) && dirname(f) === dir) ?? null;
}

// The project file of a workspace as Rocq reads it: [path in the
// workspace's folder, text, written by the user]
export function projectOf(dir: string, files: string[], read: (name: string) => string) {
  const custom = customProject(dir, files);
  return custom
    ? { file: custom, text: read(custom), custom: true }
    : { file: dir === root ? "_RocqProject" : `${dir}/_RocqProject`, text: generatedProject(dir), custom: false };
}

// The load path of a workspace: [directory relative to the workspace's
// folder ("" itself), logical name] of the -R and -Q options of its project
export function loadPath(dir: string, files: string[], read: (name: string) => string): [string, string][] {
  const { text } = projectOf(dir, files, read);
  const words = text.replace(/#.*$/gm, "").match(/"[^"]*"|\S+/g) ?? [];
  const out: [string, string][] = [];
  const self = workerDir(dir);
  for (let i = 0; i + 2 < words.length; i++)
    if (words[i] === "-R" || words[i] === "-Q") {
      let d = words[i + 1].replace(/^"|"$/g, "");
      if (d.startsWith("/")) d = d === self ? "" : d.startsWith(self + "/") ? d.slice(self.length + 1) : d;
      d = d.replace(/^\.\/?/, "").replace(/\/$/, "");
      out.push([d, words[i + 2].replace(/^"|"$/g, "")]);
      i += 2;
    }
  return out;
}

// The module of a file (Workspace.Sub.Foo, Lib.Foo), if in its
// workspace's load path
export function moduleName(file: string, workspaces: string[], files: string[], read: (name: string) => string) {
  if (!isRocq(file)) return null;
  const dir = workspaceOf(file, workspaces);
  const rel = dir === root ? file : file.slice(dir.length + 1);
  let best: [string, string] | null = null;
  for (const [d, name] of loadPath(dir, files, read))
    if ((d === "" || rel.startsWith(d + "/")) && (!best || d.length > best[0].length)) best = [d, name];
  if (!best) return null;
  const rest = rel.slice(best[0] ? best[0].length + 1 : 0).replace(/\.v$/, "").replace(/\//g, ".");
  return best[1] ? `${best[1]}.${rest}` : rest;
}

// The logical name of a workspace's folder as its project file says (the
// generated one: logicalName), if it names it
export function workspaceName(dir: string, files: string[], read: (name: string) => string) {
  return loadPath(dir, files, read).find(([d]) => d === "")?.[1] ?? null;
}

// The files of a workspace
export const filesOf = (dir: string, files: string[], workspaces: string[]) =>
  files.filter((f) => workspaceOf(f, workspaces) === dir);
