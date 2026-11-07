// The files of its workspace that a file requires, compiled to .vo before
// it is checked: each one is opened in coq-lsp, saved (coq/saveVo writes
// /workspace/PATH.vo, which the workspace's load path maps to its module)
// and closed, its own dependencies first; then coq/workspace_update makes
// coq-lsp check the documents again with them.
import type { LspClient } from "./lsp";
import { filesOf, moduleName, workerUri, workspaceOf } from "./workspaces";

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

// The files of [file]'s workspace that [text] requires: those whose module
// is the name required, or ends with it (From: starts with its prefix)
export function requires(
  file: string,
  text: string,
  files: string[],
  workspaces: string[],
  read: (name: string) => string,
): string[] {
  const modules = filesOf(workspaceOf(file, workspaces), files, workspaces).flatMap((f) => {
    const m = moduleName(f, workspaces, files, read);
    return m ? [[m, f] as const] : [];
  });
  const deps = new Set<string>();
  const re = /(?:\bFrom\s+([\w.']+)\s+)?\bRequire\s+(?:(?:Import|Export)\s+)?([^]*?)\.(?=\s|$)/g;
  for (const [, from, names] of code(text).matchAll(re))
    for (const n of names.split(/\s+/).filter(Boolean)) {
      const found = modules.find(([m]) =>
        from ? m === `${from}.${n}` || (m.startsWith(from + ".") && m.endsWith("." + n)) : m === n || m.endsWith("." + n),
      );
      if (found && found[1] !== file) deps.add(found[1]);
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
    private workspaces: () => string[],
    private read: (name: string) => string,
    private log: (message: string) => void,
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

  // The time [name] was compiled at, after its dependencies
  private async build(name: string, visiting: Set<string>): Promise<number> {
    if (visiting.has(name)) throw new Error(`${name} requires itself through other files`);
    visiting.add(name);
    const text = this.read(name);
    let newest = 0;
    for (const dep of this.requires(name)) newest = Math.max(newest, await this.build(dep, visiting));
    visiting.delete(name);
    const b = this.built.get(name);
    if (b && b.text === text && b.at >= newest) return b.at;
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
    const at = ++this.clock;
    this.built.set(name, { text, at });
    return at;
  }
}
