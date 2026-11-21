import { canBeWorkspace } from "./workspaces";
import {
  isProject,
  isRocq,
  listFiles,
  listWorkspaces,
  readFile,
  setActiveFile,
  setWorkspaces,
  temporary,
  validFolder,
  validName,
  within,
  writeFile,
} from "./storage";

// Files in the page's URL, to share them as a link, deflated and in
// base64url: one file in #share=NAME:TEXT, several (or one in a workspace)
// in #files=JSON ({ active, files: [[path, text]], workspaces })
function toBase64Url(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const fromBase64Url = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
const deflate = async (text: string) =>
  toBase64Url(await pipe(new TextEncoder().encode(text), new CompressionStream("deflate-raw")));
const inflate = async (s: string) =>
  new TextDecoder().decode(await pipe(fromBase64Url(s), new DecompressionStream("deflate-raw")));

// What a link shares (active: the file opened; workspaces: those of the
// files' folders)
export type Shared = { active: string | null; files: [string, string][]; workspaces: string[] };

// A link to the page with these files and libraries (?lib=SPEC each),
// and the folders it opens from where they came from (?open=SPEC each,
// ?file=NAME the one shown); a temporary session's (?temp, first)
export async function shareUrl(
  shared: Shared,
  libraries: string[] = [],
  base = location.href,
  opens: { open: string[]; file?: string; temp?: boolean } = { open: [] },
) {
  const url = new URL(base);
  for (const p of ["lib", "open", "file", "temp"]) url.searchParams.delete(p);
  for (const l of libraries) url.searchParams.append("lib", l);
  for (const o of opens.open) url.searchParams.append("open", o);
  if (opens.open.length && opens.file) url.searchParams.set("file", opens.file);
  if (opens.temp) {
    const rest = url.searchParams.toString();
    url.search = `?temp${rest ? `&${rest}` : ""}`;
  }
  const { files, workspaces } = shared;
  if (files.length === 0) url.hash = "";
  else if (files.length === 1 && workspaces.length === 0)
    url.hash = `share=${encodeURIComponent(files[0][0])}:${await deflate(files[0][1])}`;
  else url.hash = `files=${await deflate(JSON.stringify(shared))}`;
  return url.href;
}

// The files of the URL, if any
export async function sharedFiles(): Promise<Shared | null> {
  try {
    let m = /^#share=([^:]+):(.+)$/.exec(location.hash);
    if (m) {
      const name = decodeURIComponent(m[1]);
      return { active: name, files: [[name, await inflate(m[2])]], workspaces: [] };
    }
    m = /^#files=(.+)$/.exec(location.hash);
    if (!m) return null;
    const s = JSON.parse(await inflate(m[1]));
    const strings = (l: unknown): l is string[] => Array.isArray(l) && l.every((x) => typeof x === "string");
    const files = Array.isArray(s?.files) ? s.files.filter((f: unknown) => strings(f) && f.length === 2) : [];
    return {
      active: typeof s?.active === "string" ? s.active : null,
      files: files.filter(([p]: string[]) => validName(p)),
      workspaces: strings(s?.workspaces) ? s.workspaces.filter(validFolder) : [],
    };
  } catch {
    return null;
  }
}

// Opens the files of the URL: written to the user's (those whose path has
// another text there renamed: a file at the root N_1.v, a folder F_2/; a
// project file at the root kept as it is, the user's), the
// workspaces made such, the active one opened, the URL cleaned
export async function openShared() {
  const shared = await sharedFiles();
  if (!shared || shared.files.length === 0) return;
  const mine = new Set(listFiles());
  const differs = (path: string, text: string) => mine.has(path) && readFile(path) !== text;
  const top = (p: string) => (p.includes("/") ? p.split("/")[0] : null);
  // (the new name of each top folder, and of each file at the root)
  const folders = new Map<string, string>();
  for (const f of new Set(shared.files.map(([p]) => top(p)).filter((t): t is string => t !== null))) {
    const inside = shared.files.filter(([p]) => top(p) === f);
    let to = f;
    for (let i = 2; inside.some(([p, t]) => differs(to + p.slice(f.length), t)); i++) to = `${f}_${i}`;
    folders.set(f, to);
  }
  const rename = (p: string, text?: string) => {
    const t = top(p);
    if (t !== null) return (folders.get(t) ?? t) + p.slice(t.length);
    let name = p;
    if (text !== undefined) for (let i = 1; differs(name, text); i++) name = p.replace(/(\.[^./]*)?$/, `_${i}$1`);
    return name;
  };
  const written = new Map<string, string>();
  for (const [p, text] of shared.files) {
    if (top(p) === null && isProject(p) && differs(p, text)) continue;
    const to = rename(p, text);
    writeFile(to, text);
    written.set(p, to);
  }
  const ws = listWorkspaces();
  const renameFolder = (w: string) => {
    const t = w.split("/")[0];
    return (folders.get(t) ?? t) + w.slice(t.length);
  };
  for (const w of shared.workspaces.map(renameFolder)) if (canBeWorkspace(w, ws)) ws.push(w);
  setWorkspaces(ws);
  const active = (shared.active && written.get(shared.active)) ?? [...written.values()].find(isRocq);
  if (active) setActiveFile(active);
  if (!temporary) history.replaceState(null, "", location.pathname + location.search);
}

// A link made the page's embedded version (?embed, first)
export function embedUrl(link: string) {
  if (!link) return "";
  const url = new URL(link);
  const rest = url.searchParams.toString();
  url.search = `?embed${rest ? `&${rest}` : ""}`;
  return url.href;
}

// The HTML that embeds it in another page (allow: the iframe cross-origin
// isolated when that page is)
const attribute = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
export const embedCode = (src: string) =>
  `<iframe src="${attribute(src)}" title="Rocq" width="100%" height="500" ` +
  `style="border: 1px solid #ccc; border-radius: 6px" allow="cross-origin-isolated" loading="lazy"></iframe>`;

// The workspaces among [workspaces] that hold one of [paths]
export const workspacesOf = (paths: string[], workspaces: string[]) =>
  workspaces.filter((w) => paths.some((p) => within(p, w)));

// The libraries of the page's URL (?lib=SPEC, repeated: a GitHub
// repository, owner/repo[@ref] or its URL, or an archive's URL), added to
// the user's (hooks/useLibraries.ts), read when the page loads
export const linkedLibraries = [
  ...new Set(new URLSearchParams(location.search).getAll("lib").map((s) => s.trim()).filter(Boolean)),
];

// The URL without its libraries, once they are added (temporary: kept, its
// files are in memory only)
export function forgetLinkedLibraries() {
  if (temporary) return;
  const params = new URLSearchParams(location.search);
  if (!params.has("lib")) return;
  params.delete("lib");
  history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash);
}

// The longest links: those that chats, mail and some sites may cut, and
// those that Chrome and Edge do not open (2 MB)
export const longUrl = 8 * 1024;
export const maxUrl = 2 * 1024 * 1024;
