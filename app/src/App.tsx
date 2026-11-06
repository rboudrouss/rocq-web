import { useCallback, useEffect, useRef, useState } from "react";
import { pickBuild } from "./detect";
import { Editor, type EditorHandle } from "./Editor";
import { activeFile, listFiles, readFile, removeFile, setActiveFile, writeFile } from "./files";
import {
  type CompletionItem,
  type Diagnostic,
  type DocumentSymbol,
  type GoalsResult,
  LspClient,
  type Position,
  type Range,
} from "./lsp";
import { Files, Goals, Outline, type Package, Packages, Problems, Query, type QueryResult, Tabs } from "./panels";
import { Project, workspaceUri } from "./project";

const base = import.meta.env.BASE_URL;

// A library file shown read only (go to definition)
type Library = { uri: string; path: string; text: string; range: Range };

export function App() {
  const [build] = useState(pickBuild);
  const assets = `${base}rocq/${build}/`;
  const [files, setFiles] = useState(listFiles);
  const [active, setActive] = useState(() => activeFile(files));
  const [status, setStatus] = useState("starting");
  const [goals, setGoals] = useState<GoalsResult | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [symbols, setSymbols] = useState<DocumentSymbol[]>([]);
  const [packages, setPackages] = useState<Package[] | null>(null);
  const [queries, setQueries] = useState<QueryResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [library, setLibrary] = useState<Library | null>(null);

  const client = useRef<LspClient | null>(null);
  const project = useRef<Project | null>(null);
  const editor = useRef<EditorHandle>(null);
  const libraryEditor = useRef<EditorHandle>(null);
  const ready = useRef(false);
  const activeRef = useRef(active);
  const version = useRef(1);
  const cursor = useRef<Position>({ line: 0, character: 0 });
  // the texts not saved yet
  const texts = useRef(new Map<string, string>());
  const pendingGoTo = useRef<Range | null>(null);

  const log = useCallback((m: string) => setLogs((l) => [...l.slice(-200), m]), []);
  const read = useCallback((name: string) => texts.current.get(name) ?? readFile(name), []);
  const flush = useCallback(() => {
    for (const [name, text] of texts.current) writeFile(name, text);
    texts.current.clear();
  }, []);

  const askGoals = useCallback(() => {
    const c = client.current;
    if (!c || !ready.current) return;
    const v = version.current;
    const name = activeRef.current;
    c.goals(workspaceUri(name), v, cursor.current).then(
      (r) => v === version.current && name === activeRef.current && setGoals(r),
      (e: Error) => log(`goals: ${e.message}`),
    );
  }, [log]);

  const askSymbols = useCallback(() => {
    const c = client.current;
    if (!c || !ready.current) return;
    const name = activeRef.current;
    c.symbols(workspaceUri(name)).then(
      (s) => name === activeRef.current && setSymbols(s ?? []),
      () => {},
    );
  }, []);

  // Checks the active file, after the files it requires
  const openActive = useCallback(async () => {
    const c = client.current!;
    const name = activeRef.current;
    try {
      await project.current!.prepare(name);
    } catch (e) {
      log((e as Error).message);
    }
    if (name !== activeRef.current) return;
    c.open(workspaceUri(name), read(name), ++version.current);
  }, [log, read]);

  useEffect(() => {
    const c = new LspClient(`${base}rocq/worker.js?build=${build}`, {
      diagnostics: (u, _v, ds) => {
        if (u !== workspaceUri(activeRef.current)) return;
        editor.current?.setDiagnostics(ds);
        setDiagnostics(ds);
      },
      status: (s) => {
        setStatus(s);
        if (s === "Idle") {
          askGoals();
          askSymbols();
        }
      },
      progress: (u, rs) => u === workspaceUri(activeRef.current) && editor.current?.setProcessing(rs),
      log,
    });
    client.current = c;
    project.current = new Project(c, () => listFiles(), read, log);
    (window as unknown as { rocq: LspClient }).rocq = c;
    const t0 = performance.now();
    c.initialize().then(() => {
      log(`server ready in ${Math.round(performance.now() - t0)} ms`);
      ready.current = true;
      openActive();
    });
    fetch(`${assets}packages.json`)
      .then((r) => r.json())
      .then(setPackages, () => setPackages([]));
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      c.terminate();
    };
  }, [build, assets, askGoals, askSymbols, log, read, flush, openActive]);

  const switchTo = useCallback(
    (name: string) => {
      setLibrary(null);
      if (name === activeRef.current) return;
      flush();
      if (ready.current) client.current?.close(workspaceUri(activeRef.current));
      activeRef.current = name;
      setActive(name);
      setActiveFile(name);
      setGoals(null);
      setDiagnostics([]);
      setSymbols([]);
      cursor.current = { line: 0, character: 0 };
      if (ready.current) openActive();
    },
    [flush, openActive],
  );


  // (read by the render of the file's editor)
  useEffect(() => {
    pendingGoTo.current = null;
  }, [active]);

  const save = useRef<number | undefined>(undefined);
  const depsTimer = useRef<number | undefined>(undefined);
  const onChange = useCallback(
    (t: string) => {
      const name = activeRef.current;
      texts.current.set(name, t);
      version.current++;
      if (!ready.current) return;
      client.current?.change(workspaceUri(name), t, version.current);
      window.clearTimeout(save.current);
      save.current = window.setTimeout(flush, 500);
      // a new Require of a file of the workspace
      window.clearTimeout(depsTimer.current);
      depsTimer.current = window.setTimeout(() => {
        const p = project.current!;
        if (!p.upToDate(name)) p.prepare(name).catch((e: Error) => log(e.message));
      }, 800);
    },
    [flush, log],
  );

  const goalsTimer = useRef<number | undefined>(undefined);
  const onCursor = useCallback(
    (p: Position) => {
      cursor.current = p;
      window.clearTimeout(goalsTimer.current);
      goalsTimer.current = window.setTimeout(askGoals, 150);
    },
    [askGoals],
  );

  const hover = useCallback(
    (p: Position) =>
      ready.current && client.current ? client.current.hover(workspaceUri(activeRef.current), p) : Promise.resolve(null),
    [],
  );
  const complete = useCallback(async (p: Position): Promise<CompletionItem[]> => {
    if (!ready.current || !client.current) return [];
    const r = await client.current.completion(workspaceUri(activeRef.current), p);
    return Array.isArray(r) ? r : (r?.items ?? []);
  }, []);

  // The file of a module (Stdlib.Arith.PeanoNat, Workspace.A): the URL of
  // a library's source, or a file of the workspace
  const moduleFile = useCallback(
    (full: string): { file?: string; path?: string } | null => {
      const parts = full.split(".");
      if (parts[0] === "Workspace" && parts.length > 1) return { file: `${parts[1]}.v` };
      const modules = new Set((packages ?? []).flatMap((p) => p.modules));
      for (let n = parts.length; n > 0; n--) {
        const m = parts.slice(0, n).join(".");
        if (modules.has(m))
          return {
            path: m.startsWith("Corelib.")
              ? `coqlib/theories/${parts.slice(1, n).join("/")}.v`
              : `coqlib/user-contrib/${parts.slice(0, n).join("/")}.v`,
          };
      }
      return null;
    },
    [packages],
  );

  const showLocation = useCallback(
    async (target: { file?: string; path?: string; uri?: string }, range: Range | null, name?: string) => {
      // (coq-lsp gives the start of the file for some names: a module's)
      const find = (text: string): Range => {
        if (range && (range.start.line > 0 || range.start.character > 0 || !name)) return range;
        const decl = new RegExp(
          `(^|\\s)((Program\\s+)?(Definition|Lemma|Theorem|Fact|Remark|Corollary|Proposition|Example|Fixpoint|CoFixpoint|Inductive|CoInductive|Variant|Record|Structure|Class|Instance|Let|Axiom|Parameter|Conjecture|Hypothesis|Variable|Ltac2?|Notation|Module)\\s+|\\|\\s*)${name?.replace(/[.'\\]/g, "\\$&")}\\b`,
        );
        const i = name ? text.search(decl) : -1;
        const at = i < 0 ? 0 : i + text.slice(i).indexOf(name!);
        const before = text.slice(0, at).split("\n");
        const start = { line: before.length - 1, character: before[before.length - 1].length };
        return { start, end: { line: start.line, character: start.character + (i < 0 ? 0 : name!.length) } };
      };
      if (target.file) {
        const r = find(read(target.file));
        if (target.file === activeRef.current) goToRef.current(r);
        else {
          // the editor of the file is created there
          pendingGoTo.current = r;
          switchTo(target.file);
        }
        return;
      }
      const path = target.path!;
      const res = await fetch(assets + path);
      if (!res.ok) return log(`${path}: ${res.status}`);
      const text = await res.text();
      setLibrary({
        uri: target.uri ?? `file:///${path}`,
        path: path.replace(/^coqlib\/(user-contrib|theories)\//, ""),
        text,
        range: find(text),
      });
    },
    [assets, log, read, switchTo],
  );

  const definition = useCallback(
    async (p: Position) => {
      const c = client.current;
      if (!ready.current || !c) return;
      const uri = workspaceUri(activeRef.current);
      const line = read(activeRef.current).split("\n")[p.line] ?? "";
      let a = p.character;
      let b = p.character;
      while (a > 0 && /[\w.']/.test(line[a - 1])) a--;
      while (b < line.length && /[\w']/.test(line[b])) b++;
      const qualid = line.slice(a, b).replace(/^\.+|\.+$/g, "");
      const short = qualid.split(".").pop();
      const r = await c.definition(uri, p).catch(() => null);
      const loc = Array.isArray(r) ? r[0] : r;
      const ws = loc && /^file:\/\/\/workspace\/([^/]+\.v)$/.exec(loc.uri);
      if (ws) return showLocation({ file: ws[1] }, loc.range, short);
      if (loc) return showLocation({ uri: loc.uri, path: loc.uri.replace(/^file:\/\/\//, "") }, loc.range, short);
      // coq-lsp finds neither the definitions of the workspace's files (no
      // .glob) nor those in a module (Nat.add_comm): Locate's full name
      // gives the file, the declaration is searched in it
      if (!qualid) return;
      const located = await c.run(uri, version.current, p, `Locate ${qualid}.`).catch(() => null);
      const first = located?.feedback.map(([, m]) => m).join("\n") ?? "";
      const full = /^\s*(?:Constant|Inductive|Constructor|Ltac2?|Module(?: Type)?|Notation|Abbreviation)\s+([\w.']+)/m.exec(first)?.[1];
      const target = full && moduleFile(full);
      if (!target) return log(`no definition found for ${qualid}`);
      await showLocation(target, null, full!.split(".").pop());
    },
    [log, read, moduleFile, showLocation],
  );

  const runQuery = useCallback(
    (command: string) => {
      const c = client.current;
      if (!c || !ready.current) return;
      c.run(workspaceUri(activeRef.current), version.current, cursor.current, command).then(
        (r) => setQueries((q) => [{ command, messages: r.feedback.map(([, m]) => m) }, ...q.slice(0, 30)]),
        (e: Error) => setQueries((q) => [{ command, messages: [], error: e.message }, ...q.slice(0, 30)]),
      );
    },
    [],
  );

  const create = useCallback(
    (name: string, text = "") => {
      writeFile(name, text);
      setFiles(listFiles());
      switchTo(name);
    },
    [switchTo],
  );
  const rename = useCallback(
    (from: string, to: string) => {
      flush();
      writeFile(to, readFile(from));
      removeFile(from);
      setFiles(listFiles());
      if (activeRef.current === from) switchTo(to);
    },
    [flush, switchTo],
  );
  const remove = useCallback(
    (name: string) => {
      texts.current.delete(name);
      removeFile(name);
      const rest = listFiles();
      setFiles(rest);
      if (activeRef.current === name) switchTo(rest[0]);
    },
    [switchTo],
  );
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([read(active)], { type: "text/plain" }));
    a.download = active;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const goTo = (r: Range) => {
    setLibrary(null);
    editor.current?.goTo(r);
  };
  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  return (
    <div className="app">
      <header>
        <h1>rocq-web</h1>
        <span className="status" data-status={status}>
          {status}
        </span>
        <span className="file">{active}</span>
        <button onClick={download} title="Download the file">
          Download
        </button>
        <span className="muted">build: {build}</span>
      </header>
      <main>
        <aside className="left">
          <Tabs
            tabs={[
              ["Files", <Files files={files} active={active} open={switchTo} create={create} rename={rename} remove={remove} />],
              ["Outline", <Outline symbols={symbols} goTo={goTo} />],
              ["Packages", <Packages packages={packages} insert={(l) => (setLibrary(null), editor.current?.insertLine(l))} />],
            ]}
          />
        </aside>
        <section className="center">
          <div className="editor-wrap" hidden={library !== null}>
            <Editor
              key={active}
              ref={editor}
              initial={read(active)}
              at={pendingGoTo.current ?? undefined}
              onChange={onChange}
              onCursor={onCursor}
              hover={hover}
              complete={complete}
              definition={definition}
            />
          </div>
          {library && (
            <div className="editor-wrap library">
              <div className="library-bar">
                <span>
                  {library.path} <span className="muted">(library, read only)</span>
                </span>
                <button onClick={() => setLibrary(null)}>Back to {active}</button>
              </div>
              <Editor key={library.uri} ref={libraryEditor} initial={library.text} at={library.range} readOnly />
            </div>
          )}
        </section>
        <aside className="right">
          <h2>Goals</h2>
          <div className="goals" data-testid="goals">
            <Goals result={goals} />
          </div>
          <Tabs
            tabs={[
              [
                "Problems",
                <Problems diagnostics={diagnostics} goTo={goTo} />,
                <>
                  Problems
                  {diagnostics.some((d) => d.severity === 1) && <span className="badge"> •</span>}
                </>,
              ],
              ["Query", <Query results={queries} run={runQuery} />],
              [
                "Log",
                <div className="log">
                  {logs.map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                </div>,
              ],
            ]}
          />
        </aside>
      </main>
    </div>
  );
}
