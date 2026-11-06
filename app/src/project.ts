// The files of the workspace that a file requires, compiled to .vo before
// it is checked: each one is opened in coq-lsp, saved (coq/saveVo writes
// /workspace/NAME.vo, which the worker's load path maps to Workspace.NAME)
// and closed, its own dependencies first; then coq/workspace_update makes
// coq-lsp check the documents again with them.
import type { LspClient } from "./lsp";

export const workspaceUri = (name: string) => `file:///workspace/${name}`;
const moduleOf = (name: string) => name.replace(/\.v$/, "");

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

// The files of [files] that [text] requires
export function requires(text: string, files: string[]): string[] {
  const modules = new Map(files.map((f) => [moduleOf(f), f]));
  const deps = new Set<string>();
  const re = /(?:\bFrom\s+([\w.']+)\s+)?\bRequire\s+(?:(?:Import|Export)\s+)?([^]*?)\.(?=\s|$)/g;
  for (const [, from, names] of code(text).matchAll(re)) {
    if (from && from !== "Workspace") continue;
    for (const n of names.split(/\s+/)) {
      const f = modules.get(n.replace(/^Workspace\./, ""));
      if (f) deps.add(f);
    }
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

  // Compiles the files [name] requires (not [name]), one call at a time;
  // true when some were compiled again
  prepare(name: string): Promise<boolean> {
    const run = async () => {
      let rebuilt = false;
      for (const dep of requires(this.read(name), this.files())) {
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
    return requires(this.read(name), this.files()).every((d) => this.built.get(d)?.text === this.read(d));
  }

  // The time [name] was compiled at, after its dependencies
  private async build(name: string, visiting: Set<string>): Promise<number> {
    if (visiting.has(name)) throw new Error(`${name}: circular Require`);
    visiting.add(name);
    const text = this.read(name);
    let newest = 0;
    for (const dep of requires(text, this.files())) newest = Math.max(newest, await this.build(dep, visiting));
    visiting.delete(name);
    const b = this.built.get(name);
    if (b && b.text === text && b.at >= newest) return b.at;
    const uri = workspaceUri(name);
    const version = this.version++;
    const t0 = performance.now();
    this.client.open(uri, text, version);
    try {
      await this.client.saveVo(uri, version);
    } catch (e) {
      this.built.delete(name);
      throw new Error(`${name} does not compile: ${(e as Error).message}`);
    } finally {
      this.client.close(uri);
    }
    this.log(`compiled ${name} in ${Math.round(performance.now() - t0)} ms`);
    const at = ++this.clock;
    this.built.set(name, { text, at });
    return at;
  }
}
