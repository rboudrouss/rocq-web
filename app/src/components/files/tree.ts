// The files and folders as a tree, for the files' panel: folders first,
// then the project file, then the others, by name
import { basename, dirname, isProject } from "../../lib/storage";

export type TreeNode =
  | { kind: "folder"; path: string; name: string; children: TreeNode[] }
  | { kind: "file"; path: string; name: string };

export function buildTree(files: string[], folders: string[]): TreeNode[] {
  const byPath = new Map<string, TreeNode & { kind: "folder" }>();
  const top: TreeNode[] = [];
  const childrenOf = (dir: string) => (dir === "" ? top : folder(dir).children);
  const folder = (path: string): TreeNode & { kind: "folder" } => {
    let f = byPath.get(path);
    if (!f) {
      f = { kind: "folder", path, name: basename(path), children: [] };
      byPath.set(path, f);
      childrenOf(dirname(path)).push(f);
    }
    return f;
  };
  for (const d of folders) folder(d);
  for (const f of files) childrenOf(dirname(f)).push({ kind: "file", path: f, name: basename(f) });
  const rank = (n: TreeNode) => (n.kind === "folder" ? 0 : isProject(n.path) ? 1 : 2);
  const sort = (ns: TreeNode[]) => {
    ns.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    for (const n of ns) if (n.kind === "folder") sort(n.children);
  };
  sort(top);
  return top;
}
