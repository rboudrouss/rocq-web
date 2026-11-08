// A library of Rocq files added as a workspace (lib/workspaces.ts: the
// others require its modules by their qualified names): from a GitHub
// repository, through jsDelivr (which serves a repository's files to other
// sites, CORS, where GitHub's archives do not), from the URL of an archive,
// or from an archive on disk. Its files: its project file and the .v of the
// directories it names. Its OCaml plugins (Declare ML Module) cannot be
// built in the browser: only those of the build's packages load.
import { readArchive } from "./archive";
import type { DiskFile } from "./disk";

// (names: the logical names of its project file; plugins: whether it
// declares some)
export type Library = { name: string; files: DiskFile[]; names: string[]; plugins: boolean };

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
// (all of them without one)
export function libraryFiles(name: string, files: DiskFile[]): Library {
  const project = files.find((f) => f.path === "_RocqProject") ?? files.find((f) => f.path === "_CoqProject");
  const dirs = project ? projectDirs(project.text) : [""];
  const under = (p: string) => dirs.some((d) => d === "" || p.startsWith(`${d}/`));
  const sources = files.filter((f) => f.path.endsWith(".v") && under(f.path));
  return {
    name,
    files: project ? [project, ...sources] : sources,
    names: project ? projectPaths(project.text).map(([, n]) => n) : [],
    plugins: sources.some((f) => /\bDeclare\s+ML\s+Module\b/.test(f.text)),
  };
}

// A folder's name from a repository's or an archive's
const folderName = (n: string) => n.replace(/[^A-Za-z0-9_'.-]/g, "_").replace(/^[.'-]/, "_") || "library";

// The entries of an archive, without the folder they are all in (a
// GitHub archive's REPO-REF/), which names the library then
export async function archiveLibrary(fileName: string, data: Uint8Array): Promise<Library> {
  const entries = (await readArchive(fileName, data)).map((e) => ({ path: e.name.replace(/^\.\//, ""), data: e.data }));
  const tops = new Set(entries.map((e) => (e.path.includes("/") ? e.path.split("/")[0] : "")));
  const top = tops.size === 1 && !tops.has("") ? [...tops][0] : null;
  const files = entries
    .filter((e) => e.path.endsWith(".v") || /(^|\/)_(Rocq|Coq)Project$/.test(e.path))
    .map((e) => ({ path: top ? e.path.slice(top.length + 1) : e.path, text: text.decode(e.data) }));
  const base = (top ?? fileName.split("/").pop()!).replace(/\.(zip|tar|tar\.gz|tgz)$/i, "");
  return libraryFiles(folderName(base), files);
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

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

// A GitHub repository's library, its files fetched from jsDelivr (its
// default branch unless a ref is given)
export async function gitHubLibrary(
  { owner, repo, ref }: { owner: string; repo: string; ref: string | null },
  progress: (done: number, total: number) => void,
): Promise<Library> {
  ref ??= (await json<{ default_branch: string }>(`https://api.github.com/repos/${owner}/${repo}`)).default_branch;
  const at = `${owner}/${repo}@${ref}`;
  const listing = await json<{ files: { name: string }[] }>(`https://data.jsdelivr.com/v1/packages/gh/${at}?structure=flat`);
  const paths = listing.files.map((f) => f.name.replace(/^\//, ""));
  const project = paths.find((p) => p === "_RocqProject") ?? paths.find((p) => p === "_CoqProject");
  const get = async (p: string) => {
    const r = await fetch(`https://cdn.jsdelivr.net/gh/${at}/${p}`);
    if (!r.ok) throw new Error(`${at}/${p}: HTTP ${r.status}`);
    return { path: p, text: await r.text() };
  };
  const projectFile = project ? await get(project) : null;
  const dirs = projectFile ? projectDirs(projectFile.text) : [""];
  const wanted = paths.filter((p) => p.endsWith(".v") && dirs.some((d) => d === "" || p.startsWith(`${d}/`)));
  const files: DiskFile[] = projectFile ? [projectFile] : [];
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      files.push(await get(wanted[next++]));
      progress(files.length - (projectFile ? 1 : 0), wanted.length);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return libraryFiles(folderName(repo), files);
}

// A library from a GitHub repository or the URL of an archive
export async function fetchLibrary(spec: string, progress: (done: number, total: number) => void): Promise<Library> {
  const gh = gitHubRepository(spec);
  if (gh) return gitHubLibrary(gh, progress);
  let r: Response;
  try {
    r = await fetch(spec.trim());
  } catch {
    throw new Error(
      `${spec} could not be downloaded, its server may not let other sites download it (CORS). Download it, then import the archive`,
    );
  }
  if (!r.ok) throw new Error(`${spec}: HTTP ${r.status}`);
  return archiveLibrary(new URL(spec.trim()).pathname, new Uint8Array(await r.arrayBuffer()));
}
