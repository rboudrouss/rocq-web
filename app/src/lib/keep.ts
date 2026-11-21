// A temporary session's files kept (?temp, its banner's "Keep these
// files"): copied from memory into the user's workspace, each folder at the
// root under its name or, when the user's of that name holds other files,
// NAME_2... (as a link's, hooks/useOpenLink.ts); a file at the root whose
// name the user uses with another text renamed N_1.v, a project file at the
// root left as the user's; its workspaces, its libraries and the folders it
// opened recorded too, the file open in it opened. What it tells (the
// folders renamed), for the page loaded again without the link.
import { freeFolder } from "./disk";
import {
  example,
  isProject,
  listFiles,
  listFolders,
  listWorkspaces,
  readFile,
  setActiveFile,
  setFolders,
  setWorkspaces,
  toUserStorage,
  writeFile,
} from "./storage";
import { canBeWorkspace } from "./workspaces";

type Recorded = { folder: string; source: string; pinned?: string };

const head = (p: string) => p.split("/")[0];

export function keepTemporary(active: string, records: { libraries: Recorded[]; opened: Recorded[] }) {
  // (the session's, untouched scratch.v left out)
  const files = listFiles()
    .map((p) => [p, readFile(p)] as const)
    .filter(([p, t]) => !(p === "scratch.v" && t === example));
  const emptyFolders = listFolders();
  const workspaces = listWorkspaces();

  toUserStorage();
  // (each folder at the root, where it goes)
  const renamed = new Map<string, string>();
  const told: string[] = [];
  const tops = new Set([
    ...files.filter(([p]) => p.includes("/")).map(([p]) => head(p)),
    ...emptyFolders.map(head),
    ...workspaces.map(head),
  ]);
  for (const name of tops) {
    const inside = files.filter(([p]) => p.startsWith(`${name}/`)).map(([p, text]) => ({ path: p.slice(name.length + 1), text }));
    const to = freeFolder(name, inside, { files: listFiles(), folders: [...listFolders(), ...listWorkspaces()] }, readFile);
    renamed.set(name, to);
    if (to !== name) told.push(`The folder ${name}/ already holds other files: the session's are in ${to}/, yours are unchanged`);
    for (const { path, text } of inside) writeFile(`${to}/${path}`, text);
  }
  const move = (p: string) => {
    const h = head(p);
    return renamed.has(h) ? renamed.get(h) + p.slice(h.length) : p;
  };

  const mine = new Set(listFiles());
  const differs = (p: string, text: string) => mine.has(p) && readFile(p) !== text;
  const rootNames = new Map<string, string>();
  for (const [p, text] of files.filter(([p]) => !p.includes("/"))) {
    if (isProject(p) && differs(p, text)) continue;
    let name = p;
    for (let i = 1; differs(name, text); i++) name = p.replace(/(\.[^./]*)?$/, `_${i}$1`);
    writeFile(name, text);
    rootNames.set(p, name);
  }

  setFolders([...listFolders(), ...emptyFolders.map(move)]);
  const ws = listWorkspaces();
  for (const w of workspaces.map(move)) if (!ws.includes(w) && canBeWorkspace(w, ws)) ws.push(w);
  setWorkspaces(ws);
  for (const [key, list] of Object.entries(records)) {
    const k = `rocq-web:${key}`;
    let theirs: Recorded[] = [];
    try {
      const l = JSON.parse(localStorage.getItem(k) ?? "[]");
      if (Array.isArray(l)) theirs = l;
    } catch {
      // (none)
    }
    const moved = list.map((r) => ({ ...r, folder: move(r.folder) }));
    const folders = new Set(moved.map((r) => r.folder));
    localStorage.setItem(k, JSON.stringify([...theirs.filter((r) => !folders.has(r?.folder)), ...moved]));
  }
  setActiveFile(rootNames.get(active) ?? move(active));
  return { kept: files.length, told };
}

// The page's URL without what a link brought (the session kept)
export function withoutLink() {
  const params = new URLSearchParams(location.search);
  for (const p of ["temp", "open", "lib", "file", "example"]) params.delete(p);
  return location.pathname + (params.size ? `?${params}` : "");
}
