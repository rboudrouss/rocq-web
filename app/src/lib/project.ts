// The files of the workspaces that a file requires, compiled to .vo before
// it is checked: each one is opened in coq-lsp, saved (coq/saveVo writes
// /workspace/PATH.vo, which the workspace's load path maps to its module)
// and closed, its own dependencies first; then coq/workspace_update makes
// coq-lsp check the documents again with them. The .vo are kept in the
// browser (lib/voCache.ts) by a key of what they were compiled from: the
// libraries' version, the file's module, project and text, the .vo of its
// dependencies; the next page load writes them instead of compiling.
import type { LspClient } from "./lsp";
import { digest, getVo, putVo } from "./voCache";
import { filesOf, moduleName, root, visibleWorkspaces, workerUri, workspaceOf } from "./workspaces";

// The text without its comments (nested) and strings
function code(text: string) {
  let out = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("(*", i)) {
      depth++;
      i++;
    } else if (depth > 0 && text.startsWith("*)", i)) {
      depth--;
      i++;
    } else if (depth === 0 && text[i] === '"') {
      const end = text.indexOf('"', i + 1);
      i = end < 0 ? text.length : end;
      out += " ";
    } else if (depth === 0) out += text[i];
  }
  return out;
}

// The files that [text] requires, of [file]'s workspace (-R: those whose
// module is the name required, or ends with it) and of the workspaces it
// sees (-Q: their qualified names; the root's -R, after its own); From:
// their module starts with its prefix
export function requires(
  file: string,
  text: string,
  files: string[],
  workspaces: string[],
  read: (name: string) => string,
): string[] {
  const modulesOf = (dir: string) =>
    filesOf(dir, files, workspaces).flatMap((f) => {
      const m = moduleName(f, workspaces, files, read);
      return m ? [[m, f] as const] : [];
    });
  const own = workspaceOf(file, workspaces);
  const mine = modulesOf(own);
  const others = visibleWorkspaces(own, workspaces).flatMap(modulesOf);
  const deps = new Set<string>();
  const re = /(?:\bFrom\s+([\w.']+)\s+)?\bRequire\s+(?:(?:Import|Export)\s+)?([^]*?)\.(?=\s|$)/g;
  for (const [, from, names] of code(text).matchAll(re))
    for (const n of names.split(/\s+/).filter(Boolean)) {
      const inFrom = (m: string) => m === `${from}.${n}` || (m.startsWith(from + ".") && m.endsWith("." + n));
      const short = (m: string) => m === n || m.endsWith("." + n);
      const found =
        mine.find(([m]) => (from ? inFrom(m) : short(m))) ??
        others.find(([m]) => (from ? inFrom(m) : own === root ? short(m) : m === n));
      if (found && found[1] !== file) deps.add(found[1]);
    }
  return [...deps];
}

// (digest: the .vo's, for the keys of the files requiring it)
type Built = { text: string; key: string; digest: string; at: number };

export class Project {
  private built = new Map<string, Built>();
  private clock = 0;
  private version = 1_000_000;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private client: LspClient,
    private files: () => string[],
    private workspaces: () => string[],
    private read: (name: string) => string,
    private log: (message: string) => void,
    // the project file of a workspace as coq-lsp has it (its text)
    private registered: (dir: string) => string | undefined,
  ) {}

  private requires(file: string) {
    return requires(file, this.read(file), this.files(), this.workspaces(), this.read);
  }

  // What was compiled, to compile again (a workspace's project changed)
  forget() {
    this.built.clear();
  }

  // Compiles the files [name] requires (not [name]), one call at a time;
  // true when some were compiled again
  prepare(name: string): Promise<boolean> {
    const run = async () => {
      let rebuilt = false;
      for (const dep of this.requires(name)) {
        const before = this.clock;
        await this.build(dep, new Set([name]));
        rebuilt ||= this.clock > before;
      }
      if (rebuilt) this.client.workspaceUpdate();
      return rebuilt;
    };
    const p = this.queue.then(run);
    this.queue = p.catch(() => {});
    return p;
  }

  // Whether [name]'s dependencies were all compiled from their current text
  upToDate(name: string) {
    return this.requires(name).every((d) => this.built.get(d)?.text === this.read(d));
  }

  // The libraries' version, "" from a worker that does not tell it (no
  // .vo kept then)
  private libraries: Promise<string> | null = null;
  private keep = false;

  // What [name]'s .vo is compiled from (its module: its path and its
  // workspace's project file, as coq-lsp has it)
  private async key(name: string, text: string, deps: string[], project: string) {
    this.libraries ??= Promise.race([this.client.version, new Promise<string>((ok) => setTimeout(() => ok(""), 2000))]);
    const version = await this.libraries;
    this.keep = version !== "";
    return digest(version, name, project, text, ...deps.map((d) => this.built.get(d)?.digest ?? ""));
  }

  // The time [name] was compiled at (or its .vo written), after its
  // dependencies
  private async build(name: string, visiting: Set<string>): Promise<number> {
    if (visiting.has(name)) throw new Error(`${name} requires itself through other files`);
    visiting.add(name);
    const text = this.read(name);
    const deps = this.requires(name);
    for (const dep of deps) await this.build(dep, visiting);
    visiting.delete(name);
    const dir = workspaceOf(name, this.workspaces());
    const project = this.registered(dir) ?? "";
    const key = await this.key(name, text, deps, project);
    const b = this.built.get(name);
    if (b && b.key === key) return b.at;
    const vo = `/workspace/${name.replace(/\.v$/, ".vo")}`;
    const kept = this.keep ? await getVo(key) : null;
    if (kept) {
      await this.client.writeFile(vo, kept);
      this.log(`${name} not compiled again, its .vo kept`);
      return this.done(name, text, key, kept);
    }
    const uri = workerUri(name);
    const version = this.version++;
    const t0 = performance.now();
    this.client.open(uri, text, version);
    try {
      // (checked to its end first, when Rocq checks only on request)
      await this.client.goals(uri, version, { line: text.split("\n").length + 1, character: 0 }, "After", "Str").catch(() => {});
      await this.client.saveVo(uri, version);
    } catch (e) {
      this.built.delete(name);
      const m = (e as Error).message;
      const line = /with errors \(line (\d+)\)/.exec(m)?.[1];
      throw new Error(`${name} does not compile (${line ? `an error at line ${line}` : m})`);
    } finally {
      this.client.close(uri);
    }
    this.log(`compiled ${name} in ${Math.round(performance.now() - t0)} ms`);
    const data = await this.client.readFile(vo);
    // (not when the workspaces were read again meanwhile: compiled with
    // which project is not sure)
    if (this.keep && this.registered(dir) === project) await putVo(key, data);
    return this.done(name, text, key, data);
  }

  private async done(name: string, text: string, key: string, vo: Uint8Array) {
    const at = ++this.clock;
    this.built.set(name, { text, key, digest: await digest(vo), at });
    return at;
  }
}
