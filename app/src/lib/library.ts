// A library of Rocq files added as a workspace (lib/workspaces.ts: the
// others require its modules by their qualified names): from a GitHub
// repository, through jsDelivr (which serves a repository's files to other
// sites, CORS, where GitHub's archives do not), from the URL of an archive,
// or from an archive or a folder on disk. Its files: its project file, the
// .v of the directories it names and the files they read (Extra Dependency,
// see extra.ts). Its OCaml plugins (Declare ML Module)
// cannot be built in the browser yet: only those of the build's packages
// load.
import { readArchive } from "./archive";
import type { DiskFile } from "./disk";
import { extraDependencies, isText, keptFiles, named } from "./extra";

// (names: the logical names of its project file; plugins: whether it
// declares some; pinned: a repository's at the commit fetched,
// owner/repo@SHA, when no ref was given)
export type Library = { name: string; files: DiskFile[]; names: string[]; plugins: boolean; pinned?: string };

const text = new TextDecoder();

// The -R and -Q options of a project file: [directory ("" its own),
// logical name]
function projectPaths(project: string) {
  const words = project.replace(/#.*$/gm, "").match(/"[^"]*"|\S+/g) ?? [];
  const out: [string, string][] = [];
  for (let i = 0; i + 2 < words.length; i++)
    if (words[i] === "-R" || words[i] === "-Q") {
      const unquote = (w: string) => w.replace(/^"|"$/g, "");
      out.push([unquote(words[i + 1]).replace(/^\.\/?/, "").replace(/\/$/, ""), unquote(words[i + 2])]);
      i += 2;
    }
  return out;
}
const projectDirs = (project: string) => projectPaths(project).map(([d]) => d);

// The files of a library (paths relative to its top): its project file
// (_RocqProject, else _CoqProject), the .v under the directories it names
// (all of them without one) and the text files those .v read
export function libraryFiles(name: string, files: DiskFile[]): Library {
  const project = files.find((f) => f.path === "_RocqProject") ?? files.find((f) => f.path === "_CoqProject");
  const dirs = project ? projectDirs(project.text) : [""];
  const under = (p: string) => dirs.some((d) => d === "" || p.startsWith(`${d}/`));
  const sources = files.filter((f) => f.path.endsWith(".v") && under(f.path));
  const names = new Set(sources.flatMap((f) => extraDependencies(f.text)));
  const read = files.filter((f) => !f.path.endsWith(".v") && f !== project && named(f.path, names) && isText(f.text));
  return {
    name,
    files: [...(project ? [project] : []), ...sources, ...read],
    names: project ? projectPaths(project.text).map(([, n]) => n) : [],
    plugins: sources.some((f) => /\bDeclare\s+ML\s+Module\b/.test(f.text)),
  };
}

// A folder's name from a repository's or an archive's
const folderName = (n: string) => n.replace(/[^A-Za-z0-9_'.-]/g, "_").replace(/^[.'-]/, "_") || "library";

// The files kept of an archive (extra.ts's keptFiles), without the folder
// they are all in (a GitHub archive's REPO-REF/), which names them then
async function archiveFiles(fileName: string, data: Uint8Array): Promise<{ name: string; files: DiskFile[] }> {
  const entries = (await readArchive(fileName, data)).map((e) => ({ path: e.name.replace(/^\.\//, ""), data: e.data }));
  const tops = new Set(entries.map((e) => (e.path.includes("/") ? e.path.split("/")[0] : "")));
  const top = tops.size === 1 && !tops.has("") ? [...tops][0] : null;
  const files = (await keptFiles(entries, async (e) => text.decode(e.data))).map(({ file, text }) => ({
    path: top ? file.path.slice(top.length + 1) : file.path,
    text,
  }));
  const base = (top ?? fileName.split("/").pop()!).replace(/\.(zip|tar|tar\.gz|tgz)$/i, "");
  return { name: folderName(base), files };
}

export async function archiveLibrary(fileName: string, data: Uint8Array): Promise<Library> {
  const { name, files } = await archiveFiles(fileName, data);
  return libraryFiles(name, files);
}

// The files of a folder picked on disk (lib/disk.ts's readInput: their
// paths start with the folder's name, which names the library)
export function folderLibrary(found: DiskFile[]): Library {
  const top = found[0]?.path.split("/")[0] ?? "library";
  const files = found
    .filter((f) => f.path.startsWith(`${top}/`))
    .map((f) => ({ path: f.path.slice(top.length + 1), text: f.text }));
  return libraryFiles(folderName(top), files);
}

// owner/repo, owner/repo@ref, https://github.com/owner/repo[/tree/ref], or
// the URL of one of its archives (/archive/[refs/heads/|refs/tags/]REF.zip)
export function gitHubRepository(spec: string): { owner: string; repo: string; ref: string | null } | null {
  const s = spec.trim();
  let m = /^([\w.-]+)\/([\w.-]+?)(?:@([^\s]+))?$/.exec(s);
  if (m) return { owner: m[1], repo: m[2], ref: m[3] ?? null };
  m = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^?#]+))?\/?(?:[?#].*)?$/.exec(s);
  if (m) return { owner: m[1], repo: m[2], ref: m[3] ?? null };
  m = /^https?:\/\/(?:github\.com\/([\w.-]+)\/([\w.-]+)\/archive|codeload\.github\.com\/([\w.-]+)\/([\w.-]+)\/(?:zip|tar\.gz)|api\.github\.com\/repos\/([\w.-]+)\/([\w.-]+)\/(?:zip|tar)ball)\/(?:refs\/(?:heads|tags)\/)?([^?#]+?)(?:\.zip|\.tar\.gz)?(?:[?#].*)?$/.exec(s);
  if (m) return { owner: m[1] ?? m[3] ?? m[5], repo: m[2] ?? m[4] ?? m[6], ref: m[7] };
  return null;
}

// (missing: the message of a 404)
async function json<T>(url: string, missing: string): Promise<T> {
  const r = await fetch(url);
  if (r.status === 404) throw new Error(missing);
  if (r.status === 403 || r.status === 429)
    throw new Error(`${url}: HTTP ${r.status}, too many requests for now (give a tag or a branch: owner/repo@ref)`);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

// A commit's SHA: one of a repository's at a ref (a branch, a tag; HEAD:
// its default branch's last commit)
export const isCommit = (ref: string) => /^[0-9a-f]{40}$/i.test(ref);
export async function latestCommit(owner: string, repo: string, ref = "HEAD"): Promise<string> {
  if (isCommit(ref)) return ref;
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, {
    headers: { Accept: "application/vnd.github.sha" },
  });
  if (r.status === 404 || r.status === 422)
    throw new Error(ref === "HEAD" ? `${owner}/${repo} is not a public GitHub repository` : `${owner}/${repo}@${ref} not found`);
  if (r.status === 403 || r.status === 429)
    throw new Error(`GitHub refuses more requests for now (HTTP ${r.status}). Give a tag or a commit, as owner/repo@ref`);
  if (!r.ok) throw new Error(`GitHub answered HTTP ${r.status}`);
  const sha = (await r.text()).trim();
  if (!isCommit(sha)) throw new Error(`GitHub gave no commit for ${owner}/${repo}@${ref}`);
  return sha;
}

// A GitHub repository's library, its files fetched from jsDelivr (its
// default branch's last commit unless a ref is given)
export async function gitHubLibrary(
  { owner, repo, ref }: { owner: string; repo: string; ref: string | null },
  progress: (done: number, total: number) => void,
): Promise<Library> {
  const pinned = ref === null;
  ref ??= await latestCommit(owner, repo);
  const at = `${owner}/${repo}@${ref}`;
  const listing = await json<{ files: { name: string }[] }>(
    `https://data.jsdelivr.com/v1/packages/gh/${at}?structure=flat`,
    `${at} not found: no public repository with this branch, tag or commit`,
  );
  const paths = listing.files.map((f) => f.name.replace(/^\//, ""));
  const project = paths.find((p) => p === "_RocqProject") ?? paths.find((p) => p === "_CoqProject");
  const projectFile = project ? await jsDelivrFile(at, project) : null;
  const dirs = projectFile ? projectDirs(projectFile.text) : [""];
  const wanted = paths.filter((p) => p.endsWith(".v") && dirs.some((d) => d === "" || p.startsWith(`${d}/`)));
  const files: DiskFile[] = [...(projectFile ? [projectFile] : []), ...(await jsDelivrFiles(at, wanted, progress))];
  // the files they read
  const names = new Set(files.filter((f) => f.path.endsWith(".v")).flatMap((f) => extraDependencies(f.text)));
  for (const p of paths) if (!p.endsWith(".v") && p !== project && named(p, names)) files.push(await jsDelivrFile(at, p));
  return { ...libraryFiles(folderName(repo), files), ...(pinned && { pinned: at }) };
}

// A file of a repository at owner/repo@ref, from jsDelivr
async function jsDelivrFile(at: string, path: string): Promise<DiskFile> {
  const r = await fetch(`https://cdn.jsdelivr.net/gh/${at}/${path}`);
  if (!r.ok) throw new Error(`${at}/${path}: HTTP ${r.status}`);
  return { path, text: await r.text() };
}

// Files of a repository, 8 at a time
async function jsDelivrFiles(at: string, paths: string[], progress: (done: number, total: number) => void) {
  const files: DiskFile[] = [];
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      files.push(await jsDelivrFile(at, paths[next++]));
      progress(files.length, paths.length);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return files;
}

// An archive's URL, downloaded: its path and bytes
async function download(spec: string) {
  let r: Response;
  try {
    r = await fetch(spec.trim());
  } catch {
    throw new Error(
      `${spec} could not be downloaded, its server may not let other sites download it (CORS). Download it, then import the archive`,
    );
  }
  if (!r.ok) throw new Error(`${spec}: HTTP ${r.status}`);
  return [new URL(spec.trim()).pathname, new Uint8Array(await r.arrayBuffer())] as const;
}

// A library from a GitHub repository or the URL of an archive
export async function fetchLibrary(spec: string, progress: (done: number, total: number) => void): Promise<Library> {
  const gh = gitHubRepository(spec);
  if (gh) return gitHubLibrary(gh, progress);
  return archiveLibrary(...(await download(spec)));
}

// What a link opens as files (?open=SPEC): a GitHub repository, or one of
// its folders, owner/repo[@ref][:folder] (git forbids ':' in a ref) or
// https://github.com/owner/repo[/tree/REF[/FOLDER]] (REF without '/'
// there); else the URL of an archive (zip, tar, tar.gz)
export type Opened = { owner: string; repo: string; ref: string | null; folder: string };
export function gitHubFolder(spec: string): Opened | null {
  const s = spec.trim();
  const url = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^/?#]+)((?:\/[^?#]*)?))?\/?(?:[?#].*)?$/.exec(s);
  if (url) return { owner: url[1], repo: url[2], ref: url[3] ?? null, folder: url[4] ?? "" };
  // (one of its archives' URLs: the repository through jsDelivr)
  if (/^https?:/.test(s)) {
    const gh = gitHubRepository(s);
    return gh && { ...gh, folder: "" };
  }
  const [repo, ...rest] = s.split(":");
  const gh = gitHubRepository(repo);
  return gh && { ...gh, folder: rest.join(":") };
}
export const openable = (spec: string) => gitHubFolder(spec) !== null || /^https?:\/\/\S+$/.test(spec.trim());

// The files a link opens: those of a repository's folder (the paths
// relative to it) or of an archive, kept as an import keeps them
// (extra.ts's keptFiles: the Rocq and project files, the files they read;
// not those of hidden folders, _build, node_modules), and the folder they
// go to (the repository's or the archive's name)
export async function fetchProject(
  spec: string,
  progress: (done: number, total: number) => void,
): Promise<{ name: string; files: DiskFile[] }> {
  const gh = gitHubFolder(spec);
  if (!gh) {
    const { name, files } = await archiveFiles(...(await download(spec)));
    return { name, files: files.filter((f) => !skippedPath(f.path)).sort(byPath) };
  }
  const at = `${gh.owner}/${gh.repo}@${gh.ref ?? (await latestCommit(gh.owner, gh.repo))}`;
  const folder = gh.folder.replace(/^\/+|\/+$/g, "");
  const listing = await json<{ files: { name: string }[] }>(
    `https://data.jsdelivr.com/v1/packages/gh/${at}?structure=flat`,
    `${at} not found: no public repository with this branch, tag or commit`,
  );
  const prefix = folder ? `${folder}/` : "";
  const paths = listing.files
    .map((f) => f.name.replace(/^\//, ""))
    .filter((p) => p.startsWith(prefix))
    .map((p) => p.slice(prefix.length))
    .filter((p) => !skippedPath(p));
  if (folder && paths.length === 0) throw new Error(`${at} has no folder ${folder}`);
  const rocq = (p: string) => p.endsWith(".v") || /(^|\/)_(Rocq|Coq)Project$/.test(p);
  const relative = (f: DiskFile) => ({ path: f.path.slice(prefix.length), text: f.text });
  const files = (await jsDelivrFiles(at, paths.filter(rocq).map((p) => prefix + p), progress)).map(relative);
  // the files they read
  const names = new Set(files.filter((f) => f.path.endsWith(".v")).flatMap((f) => extraDependencies(f.text)));
  for (const p of paths)
    if (!rocq(p) && named(p, names)) {
      const f = relative(await jsDelivrFile(at, prefix + p));
      if (isText(f.text)) files.push(f);
    }
  return { name: folderName(gh.repo), files: files.sort(byPath) };
}

const byPath = (a: DiskFile, b: DiskFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

// (a file of a hidden folder, _build or node_modules, as lib/disk.ts)
const skippedPath = (path: string) =>
  path.split("/").slice(0, -1).some((d) => d.startsWith(".") || d === "_build" || d === "node_modules");
