// The files of the workspace that a file requires, compiled to .vo before
// it is checked: each one is opened in coq-lsp, saved (coq/saveVo writes
// /workspace/NAME.vo, which the worker's load path maps to Workspace.NAME)
// and closed, its own dependencies first; then coq/workspace_update makes
// coq-lsp check the documents again with them.
import { isRocq, projectFile } from "./files";
import type { LspClient } from "./lsp";

export const workspaceUri = (name: string) => `file:///workspace/${name}`;

// The logical names of the workspace's directories: [directory (relative,
// "" the workspace), name] of the -R and -Q options of its _RocqProject,
// or the worker's (-R /workspace Workspace)
export function loadPath(files: string[], read: (name: string) => string): [string, string][] {
  if (!files.includes(projectFile)) return [["", "Workspace"]];
  const words = read(projectFile).replace(/#.*$/gm, "").match(/"[^"]*"|\S+/g) ?? [];
  const out: [string, string][] = [];
  for (let i = 0; i + 2 < words.length; i++)
    if (words[i] === "-R" || words[i] === "-Q") {
      const dir = words[i + 1].replace(/^"|"$/g, "").replace(/^\/workspace\/?/, "").replace(/^\.\/?/, "").replace(/\/$/, "");
      out.push([dir, words[i + 2].replace(/^"|"$/g, "")]);
      i += 2;
    }
  return out;
}

// The module of a file of the workspace (Workspace.Sub.Foo), if in the
// load path
export function moduleName(file: string, lp: [string, string][]): string | null {
  if (!isRocq(file)) return null;
  let best: [string, string] | null = null;
  for (const [dir, name] of lp)
    if ((dir === "" || file.startsWith(dir + "/")) && (!best || dir.length > best[0].length)) best = [dir, name];
  if (!best) return null;
  const rest = file.slice(best[0] ? best[0].length + 1 : 0).replace(/\.v$/, "").replace(/\//g, ".");
  return best[1] ? `${best[1]}.${rest}` : rest;
}

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

// The files of [files] that [text] requires: those whose module is the
// name required, or ends with it (From: starts with its prefix)
export function requires(text: string, files: string[], lp: [string, string][]): string[] {
  const modules = files.flatMap((f) => {
    const m = moduleName(f, lp);
    return m ? [[m, f] as const] : [];
  });
  const deps = new Set<string>();
  const re = /(?:\bFrom\s+([\w.']+)\s+)?\bRequire\s+(?:(?:Import|Export)\s+)?([^]*?)\.(?=\s|$)/g;
  for (const [, from, names] of code(text).matchAll(re))
    for (const n of names.split(/\s+/).filter(Boolean)) {
      const found = modules.find(([m]) =>
        from ? m === `${from}.${n}` || (m.startsWith(from + ".") && m.endsWith("." + n)) : m === n || m.endsWith("." + n),
      );
      if (found) deps.add(found[1]);
    }
  return [...deps];
}

type Built = { text: string; at: number };

export class Project {
  private built = new Map<string, Built>();
  private clock = 0;
  private version = 1_000_000;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private client: LspClient,
    private files: () => string[],
    private read: (name: string) => string,
    private log: (message: string) => void,
  ) {}

  private requires(text: string) {
    const files = this.files();
    return requires(text, files, loadPath(files, this.read));
  }

  // Compiles the files [name] requires (not [name]), one call at a time;
  // true when some were compiled again
  prepare(name: string): Promise<boolean> {
    const run = async () => {
      let rebuilt = false;
      for (const dep of this.requires(this.read(name))) {
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
    return this.requires(this.read(name)).every((d) => this.built.get(d)?.text === this.read(d));
  }

  // The time [name] was compiled at, after its dependencies
  private async build(name: string, visiting: Set<string>): Promise<number> {
    if (visiting.has(name)) throw new Error(`${name} requires itself through other files`);
    visiting.add(name);
    const text = this.read(name);
    let newest = 0;
    for (const dep of this.requires(text)) newest = Math.max(newest, await this.build(dep, visiting));
    visiting.delete(name);
    const b = this.built.get(name);
    if (b && b.text === text && b.at >= newest) return b.at;
    const uri = workspaceUri(name);
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
    const at = ++this.clock;
    this.built.set(name, { text, at });
    return at;
  }
}
