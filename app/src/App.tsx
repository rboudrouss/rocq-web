import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pickBuild } from "./detect";
import { Editor, type EditorHandle } from "./Editor";
import { Goals } from "./goals";
import { type Example, examples, loadExample } from "./examples";
import {
  activeFile,
  embedded,
  isRocq,
  listFiles,
  projectFile,
  readFile,
  removeFile,
  saveToDisk,
  setActiveFile,
  validName,
  writeFile,
} from "./files";
import {
  type CompletionItem,
  type Diagnostic,
  type DocumentSymbol,
  type GoalsResult,
  LspClient,
  type Position,
  type Range,
} from "./lsp";
import { Files, LibrarySearch, Outline, type Package, Packages, Problems, Query, type QueryResult, Tabs } from "./panels";
import { loadPath, moduleName, Project, workspaceUri } from "./project";
import { offsetAt, positionAt, sentenceAt, sentences } from "./sentences";
import { shareUrl } from "./share";
import { unzip, zip } from "./zip";

const base = import.meta.env.BASE_URL;

// The _RocqProject of a workspace without one
const defaultProject = "-R /workspace Workspace\n-arg -w -arg -extraction-default-directory\n";

function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// A file shown read only: a library's (go to definition), or one Rocq
// wrote (Extraction...)
type Library = { uri: string; path: string; text: string; range: Range; note?: string };

export function App() {
  const [build] = useState(pickBuild);
  const assets = `${base}rocq/${build}/`;
  const [files, setFiles] = useState(listFiles);
  const [active, setActive] = useState(() => activeFile(files));
  const [status, setStatus] = useState("starting");
  // the goals after the sentence at the cursor, and before it
  const [goals, setGoals] = useState<{ now: GoalsResult; before: GoalsResult | null } | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [symbols, setSymbols] = useState<DocumentSymbol[]>([]);
  const [packages, setPackages] = useState<Package[] | null>(null);
  const [queries, setQueries] = useState<QueryResult[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [library, setLibrary] = useState<Library | null>(null);
  const [shared, setShared] = useState<string | null>(null);
  // the files Rocq wrote in the workspace (Extraction...): [path, size]
  const [produced, setProduced] = useState<[string, number][]>([]);
  // _RocqProject changed since Rocq started
  const [projectChanged, setProjectChanged] = useState(false);
  // why the files the active one requires were not compiled
  const [depError, setDepError] = useState<string | null>(null);
  // the libraries' files downloaded while Rocq is busy
  // a new worker when it changes (Restart)
  const [generation, setGeneration] = useState(0);
  const [fetching, setFetching] = useState<{ path: string; files: number; bytes: number } | null>(null);
  // Rocq checks the file up to the cursor on request (Alt+Enter), not all
  // of it as it changes
  const [toCursor, setToCursor] = useState(() => localStorage.getItem("rocq-web:check") === "cursor");
  const [help, setHelp] = useState(false);
  const [exampleList, setExampleList] = useState<Example[] | null>(null);

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
  const toCursorRef = useRef(toCursor);
  // (checking up to the cursor) the offset Rocq checked the file up to
  const checkedTo = useRef(0);
  const diagnosticsRef = useRef<Diagnostic[]>([]);

  const log = useCallback((m: string) => setLogs((l) => [...l.slice(-200), m]), []);
  // A file of the workspace to the worker's (for Load, _RocqProject)
  const toWorker = (name: string, text: string | null) => {
    const c = client.current;
    if (!c) return;
    const done =
      text !== null
        ? c.writeFile(`/workspace/${name}`, text)
        : name === projectFile
          ? c.writeFile(`/workspace/${name}`, defaultProject)
          : c.removeFile(`/workspace/${name}`);
    done.catch((e: Error) => log(`${name}: ${e.message}`));
    if (name === projectFile) setProjectChanged(true);
  };
  const read = useCallback((name: string) => texts.current.get(name) ?? readFile(name), []);
  const flush = useCallback(() => {
    for (const [name, text] of texts.current) {
      writeFile(name, text);
      saveToDisk(name, text).catch((e: Error) => log(`${name} was not saved to disk (${e.message})`));
      toWorker(name, text);
    }
    texts.current.clear();
  }, [log]);

  const askGoals = useCallback(() => {
    const c = client.current;
    if (!c || !ready.current) return;
    const v = version.current;
    const name = activeRef.current;
    const uri = workspaceUri(name);
    const at = cursor.current;
    // (the answer for the cursor where it still is)
    const current = () => v === version.current && name === activeRef.current && at === cursor.current;
    if (toCursorRef.current && offsetAt(read(name), at) > checkedTo.current) return setGoals(null);
    c.goals(uri, v, at).then(
      async (now) => {
        if (!current()) return;
        // (before the sentence: at its start)
        const text = read(name);
        const s = sentenceAt(sentences(text), offsetAt(text, at));
        const before = s ? await c.goals(uri, v, positionAt(text, s.start), "Prev").catch(() => null) : null;
        if (current()) setGoals({ now, before });
      },
      (e: Error) => log(`goals: ${e.message}`),
    );
  }, [log, read]);

  // (not those of Rocq's, nor the user's)
  const listProduced = useCallback(() => {
    const c = client.current;
    if (!c) return;
    c.listFiles("/workspace").then(
      (fs) => {
        const mine = new Set(listFiles());
        setProduced(
          fs
            .map(([p, size]) => [p.replace(/^\/workspace\//, ""), size] as [string, number])
            .filter(([p]) => !mine.has(p) && !/\.(vo|vos|vok|glob|aux|v)$|(^|\/)\.[^/]*$/.test(p) && p !== projectFile)
            .sort(),
        );
      },
      () => {},
    );
  }, []);

  const askSymbols = useCallback(() => {
    const c = client.current;
    if (!c || !ready.current || !isRocq(activeRef.current)) return;
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
    if (!isRocq(name)) return;
    try {
      await project.current!.prepare(name);
      setDepError(null);
    } catch (e) {
      log((e as Error).message);
      setDepError((e as Error).message);
    }
    if (name !== activeRef.current) return;
    c.open(workspaceUri(name), read(name), ++version.current);
  }, [log, read]);

  useEffect(() => {
    const c = new LspClient(`${base}rocq/worker.js?build=${build}`, {
      diagnostics: (u, _v, ds) => {
        if (u !== workspaceUri(activeRef.current)) return;
        editor.current?.setDiagnostics(ds);
        diagnosticsRef.current = ds;
        setDiagnostics(ds);
      },
      fetch: (path, size) =>
        setFetching((f) => ({ path, files: (f?.files ?? 0) + 1, bytes: (f?.bytes ?? 0) + size })),
      status: (s) => {
        setStatus(s);
        if (s === "Idle") setFetching(null);
        if (s === "Idle") {
          askGoals();
          askSymbols();
          listProduced();
        }
      },
      progress: (u, rs) => u === workspaceUri(activeRef.current) && editor.current?.setProcessing(rs),
      log,
    });
    client.current = c;
    ready.current = false;
    setStatus("starting");
    project.current = new Project(c, () => listFiles(), read, log);
    // the files of the workspace, before Rocq starts
    const all = listFiles();
    for (const f of all) c.writeFile(`/workspace/${f}`, read(f)).catch(() => {});
    // (without the user's, the worker's, Extraction's files in the
    // workspace without a warning)
    if (!all.includes(projectFile)) c.writeFile(`/workspace/${projectFile}`, defaultProject).catch(() => {});
    setProjectChanged(false);
    (window as unknown as { rocq: LspClient }).rocq = c;
    const t0 = performance.now();
    checkedTo.current = 0;
    c.initialize(toCursorRef.current).then(() => {
      log(`server ready in ${Math.round(performance.now() - t0)} ms`);
      ready.current = true;
      // (busy once it checks a file)
      setStatus("Idle");
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
  }, [build, assets, askGoals, askSymbols, listProduced, log, read, flush, openActive, generation]);

  const switchTo = useCallback(
    (name: string) => {
      setLibrary(null);
      if (name === activeRef.current) return;
      flush();
      if (ready.current && isRocq(activeRef.current)) {
        client.current?.close(workspaceUri(activeRef.current));
        // (what coq-lsp keeps of the file and of the states it went through)
        client.current?.notify("coq/trimCaches", {});
      }
      activeRef.current = name;
      setActive(name);
      setActiveFile(name);
      setGoals(null);
      setDepError(null);
      setDiagnostics([]);
      diagnosticsRef.current = [];
      setSymbols([]);
      cursor.current = { line: 0, character: 0 };
      checkedTo.current = 0;
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
      if (toCursorRef.current) {
        // checked up to the sentence before the change
        const old = read(name);
        let d = 0;
        while (d < t.length && d < old.length && t[d] === old[d]) d++;
        if (d < checkedTo.current) {
          checkedTo.current = sentences(t).reduce((e, s) => (s.end <= d ? s.end : e), 0);
          editor.current?.setUnchecked(positionAt(t, checkedTo.current));
        }
      }
      texts.current.set(name, t);
      version.current++;
      window.clearTimeout(save.current);
      save.current = window.setTimeout(flush, 500);
      if (!ready.current || !isRocq(name)) return;
      client.current?.change(workspaceUri(name), t, version.current);
      // a new Require of a file of the workspace
      window.clearTimeout(depsTimer.current);
      depsTimer.current = window.setTimeout(() => {
        const p = project.current!;
        if (!p.upToDate(name))
          p.prepare(name).then(
            () => setDepError(null),
            (e: Error) => (log(e.message), setDepError(e.message)),
          );
      }, 800);
    },
    [flush, log, read],
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

  // Checks up to a point (when checking up to the cursor), shows its goals
  const checkTo = useCallback(
    (p: Position) => {
      if (toCursorRef.current) {
        const text = read(activeRef.current);
        // (to the end of the sentence there)
        const s = sentenceAt(sentences(text), offsetAt(text, p));
        checkedTo.current = Math.max(offsetAt(text, p), s?.end ?? 0);
        editor.current?.setUnchecked(positionAt(text, checkedTo.current));
      }
      cursor.current = p;
      askGoals();
    },
    [askGoals, read],
  );

  // The cursor after the next sentence, or the previous one, checked
  const step = useCallback(
    (p: Position, forward: boolean) => {
      const text = read(activeRef.current);
      const o = offsetAt(text, p);
      const list = sentences(text);
      const s = forward ? list.find((s) => s.end > o) : list.filter((s) => s.end < o).pop();
      const to = positionAt(text, s ? s.end : forward ? text.length : 0);
      editor.current?.goTo(to, false);
      checkTo(to);
    },
    [checkTo, read],
  );

  // The cursor on the next problem, or the previous one
  const problem = useCallback((p: Position, forward: boolean) => {
    const ds = diagnosticsRef.current.filter((d) => d.severity <= 2);
    if (ds.length === 0) return;
    const key = (q: Position) => q.line * 1e6 + q.character;
    const sorted = [...ds].sort((a, b) => key(a.range.start) - key(b.range.start));
    const k = key(p);
    const d = forward
      ? (sorted.find((d) => key(d.range.start) > k) ?? sorted[0])
      : (sorted.filter((d) => key(d.range.start) < k).pop() ?? sorted[sorted.length - 1]);
    editor.current?.goTo(d.range);
  }, []);

  const keys = useMemo(
    () => ({
      "Alt-Enter": checkTo,
      "Ctrl-Enter": checkTo,
      "Alt-n": (p: Position) => step(p, true),
      "Alt-p": (p: Position) => step(p, false),
      F8: (p: Position) => problem(p, true),
      "Shift-F8": (p: Position) => problem(p, false),
    }),
    [checkTo, step, problem],
  );

  const changeMode = (cursorMode: boolean) => {
    setToCursor(cursorMode);
    toCursorRef.current = cursorMode;
    localStorage.setItem("rocq-web:check", cursorMode ? "cursor" : "all");
    const c = client.current;
    if (!c || !ready.current) return;
    c.configure(cursorMode);
    const name = activeRef.current;
    const text = read(name);
    if (cursorMode) {
      // (all of it was checked)
      checkedTo.current = text.length;
    } else {
      editor.current?.setUnchecked(null);
      // checks it all again
      c.change(workspaceUri(name), text, ++version.current);
    }
  };

  const hover = useCallback(
    (p: Position) =>
      ready.current && client.current && isRocq(activeRef.current)
        ? client.current.hover(workspaceUri(activeRef.current), p)
        : Promise.resolve(null),
    [],
  );
  const complete = useCallback(async (p: Position): Promise<CompletionItem[]> => {
    if (!ready.current || !client.current || !isRocq(activeRef.current)) return [];
    const r = await client.current.completion(workspaceUri(activeRef.current), p);
    return Array.isArray(r) ? r : (r?.items ?? []);
  }, []);

  // The file of a module (Stdlib.Arith.PeanoNat, Workspace.A): the URL of
  // a library's source, or a file of the workspace
  const moduleFile = useCallback(
    (full: string): { file?: string; path?: string } | null => {
      const parts = full.split(".");
      // (the longest module of the workspace the name starts with)
      const files = listFiles();
      const lp = loadPath(files, read);
      const mine = files
        .map((f) => [moduleName(f, lp), f] as const)
        .filter(([m]) => m && (full === m || full.startsWith(m + ".")))
        .sort((a, b) => b[0]!.length - a[0]!.length);
      if (mine.length) return { file: mine[0][1] };
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
    [packages, read],
  );

  const showLocation = useCallback(
    async (target: { file?: string; path?: string; uri?: string }, range: Range | null, name?: string) => {
      // (coq-lsp gives the start of the file for some names: a module's)
      const find = (text: string): Range => {
        if (range && range.start.line > 0 && name) {
          // (the name on the range's line)
          const l = text.split("\n")[range.start.line] ?? "";
          const c = l.search(new RegExp(`(^|[^\\w'.])${name.replace(/[.'\\]/g, "\\$&")}(?![\\w'])`));
          if (c >= 0) {
            const character = c + (l[c] === name[0] ? 0 : 1);
            return { start: { line: range.start.line, character }, end: { line: range.start.line, character: character + name.length } };
          }
        }
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
      if (!res.ok) return log(`cannot download ${path} (HTTP ${res.status})`);
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
      if (!ready.current || !c || !isRocq(activeRef.current)) return;
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
      const ws = loc && /^file:\/\/\/workspace\/(.+\.v)$/.exec(loc.uri);
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
      toWorker(name, text);
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
      toWorker(from, null);
      toWorker(to, readFile(to));
      setFiles(listFiles());
      if (activeRef.current === from) switchTo(to);
    },
    [flush, switchTo],
  );
  const remove = useCallback(
    (name: string) => {
      texts.current.delete(name);
      removeFile(name);
      toWorker(name, null);
      const rest = listFiles();
      setFiles(rest);
      if (activeRef.current === name) switchTo(rest[0]);
    },
    [switchTo],
  );
  const share = async () => {
    const url = await shareUrl(active, read(active));
    await navigator.clipboard?.writeText(url).catch(() => {});
    log(`link to ${active} copied (${url.length} characters)`);
    setShared(url);
  };
  const showExamples = () =>
    examples().then(setExampleList, (e: Error) => log(`examples: ${e.message}`));
  const openExample = async (e: Example) => {
    setExampleList(null);
    flush();
    try {
      const paths = await loadExample(e);
      for (const p of paths) toWorker(p, readFile(p));
      setFiles(listFiles());
      switchTo(paths[0]);
    } catch (err) {
      log((err as Error).message);
    }
  };
  // The page with this file, not embedded
  const openFull = async () => {
    const url = new URL(await shareUrl(active, read(active)));
    url.search = "";
    window.open(url.href, "_blank", "noopener");
  };

  const download = () => saveBlob(new Blob([read(active)], { type: "text/plain" }), active.split("/").pop()!);

  const exportZip = async () => {
    flush();
    const enc = new TextEncoder();
    saveBlob(await zip(listFiles().map((f) => ({ name: f, data: enc.encode(readFile(f)) }))), "rocq-workspace.zip");
  };
  const importZip = async (file: File) => {
    try {
      const entries = await unzip(await file.arrayBuffer());
      // (an archive of a folder: its files)
      const top = entries[0]?.name.split("/")[0];
      const strip = entries.length > 0 && entries.every((e) => e.name.startsWith(top + "/")) ? top.length + 1 : 0;
      const dec = new TextDecoder();
      const found = entries.map((e) => [e.name.slice(strip), dec.decode(e.data)] as const).filter(([n]) => validName(n));
      if (found.length === 0) return log(`${file.name} has no .v files`);
      const mine = listFiles();
      const replaced = found.filter(([n, t]) => mine.includes(n) && readFile(n) !== t).map(([n]) => n);
      if (replaced.length && !confirm(`Replace ${replaced.join(", ")}?`)) return;
      flush();
      for (const [n, t] of found) {
        writeFile(n, t);
        toWorker(n, t);
      }
      setFiles(listFiles());
      log(`${found.length} files from ${file.name}`);
      const first = found.find(([n]) => isRocq(n));
      if (first) switchTo(first[0]);
    } catch (e) {
      log(`${file.name}: ${(e as Error).message}`);
    }
  };
  const viewProduced = async (path: string) => {
    const data = await client.current?.readFile(`/workspace/${path}`).catch(() => null);
    if (!data) return log(`cannot read ${path}`);
    const zero = { line: 0, character: 0 };
    setLibrary({
      uri: `produced:${path}:${data.length}`,
      path,
      text: new TextDecoder().decode(data),
      range: { start: zero, end: zero },
      note: "written by Rocq, read only",
    });
  };
  const downloadProduced = async (path: string) => {
    const data = await client.current?.readFile(`/workspace/${path}`).catch(() => null);
    if (data) saveBlob(new Blob([data as Uint8Array<ArrayBuffer>]), path.split("/").pop()!);
  };

  const goTo = (r: Range) => {
    setLibrary(null);
    editor.current?.goTo(r);
  };
  const goToRef = useRef(goTo);
  goToRef.current = goTo;

  return (
    <div className={embedded ? "app embed" : "app"}>
      <header>
        <h1>rocq-web</h1>
        <span className="status" data-status={status}>
          {status}
        </span>
        {fetching && (
          <span className="fetching" title={fetching.path}>
            downloading {fetching.path.replace(/^\/coqlib\/(user-contrib|theories)\//, "").replace(/^\/plugins\//, "plugin ")} (
            {fetching.files} files, {(fetching.bytes / 1e6).toFixed(1)} MB)
          </span>
        )}
        <span className="file">{active}</span>
        <select
          value={toCursor ? "cursor" : "all"}
          onChange={(e) => changeMode(e.target.value === "cursor")}
          title="When Rocq checks the file (up to the cursor: Alt+Enter)"
        >
          <option value="all">Check as you type</option>
          <option value="cursor">Check up to the cursor</option>
        </select>
        {embedded ? (
          <button onClick={openFull} title="This file in rocq-web, in a new tab">
            Open in rocq-web ↗
          </button>
        ) : (
          <>
            <button
              onClick={() => {
                flush();
                setGeneration((g) => g + 1);
              }}
              title="Start Rocq again (a computation that does not stop)"
            >
              Restart
            </button>
            <button onClick={showExamples} title="Examples and tutorials">
              Examples
            </button>
            <button onClick={share} title="Copy a link to this file">
              Share
            </button>
            <button onClick={download} title="Download the file">
              Download
            </button>
          </>
        )}
        <button onClick={() => setHelp(!help)} title="Keyboard shortcuts">
          ?
        </button>
        {!embedded && <span className="muted">build: {build}</span>}
      </header>
      {exampleList && (
        <div className="modal" onClick={() => setExampleList(null)}>
          <div className="examples" onClick={(e) => e.stopPropagation()}>
            <h2>Examples</h2>
            <p className="muted">
              An example's files are copied into a folder of your workspace. A link with <code>?example=Basics</code> opens
              one directly, and <code>?embed</code> shows it in another page (an iframe).
            </p>
            <ul>
              {exampleList.map((e) => (
                <li key={e.id}>
                  <button onClick={() => openExample(e)}>
                    <b>{e.title}</b> <span className="muted">{e.files.join(", ")}</span>
                    <div>{e.description}</div>
                  </button>
                </li>
              ))}
            </ul>
            <button onClick={() => setExampleList(null)}>Close</button>
          </div>
        </div>
      )}
      {help && (
        <div className="help" onClick={() => setHelp(false)}>
          <table>
            <tbody>
              {[
                ["Alt+Enter, Ctrl+Enter", "Check up to the cursor"],
                ["Alt+N, Alt+P", "Next or previous sentence (checked)"],
                ["F8, Shift+F8", "Next or previous error or warning"],
                ["F12, Ctrl+click", "Go to the definition"],
                ["Ctrl+Space", "Complete a name, or a symbol after a backslash (\\forall)"],
              ].map(([k, what]) => (
                <tr key={k}>
                  <td>
                    <kbd>{k}</kbd>
                  </td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {projectChanged && (
        <div className="shared">
          Rocq reads <code>_RocqProject</code> when it starts.
          <button
            onClick={() => {
              flush();
              setGeneration((g) => g + 1);
            }}
          >
            Restart Rocq
          </button>
          <button onClick={() => setProjectChanged(false)}>×</button>
        </div>
      )}
      {shared && (
        <div className="shared">
          Link copied to the clipboard <input readOnly value={shared} onFocus={(e) => e.target.select()} />
          <button onClick={() => setShared(null)}>×</button>
        </div>
      )}
      <main>
        <aside className="left" hidden={embedded}>
          <Tabs
            tabs={[
              [
                "Files",
                <Files
                  files={files}
                  active={active}
                  open={switchTo}
                  create={create}
                  rename={rename}
                  remove={remove}
                  opened={(names) => {
                    for (const n of names) toWorker(n, readFile(n));
                    setFiles(listFiles());
                    const first = names.find(isRocq);
                    if (first) switchTo(first);
                    log(`opened ${names.length} files from disk`);
                  }}
                  exportZip={exportZip}
                  importZip={importZip}
                  produced={produced}
                  view={viewProduced}
                  download={downloadProduced}
                />,
              ],
              ["Outline", <Outline symbols={symbols} goTo={goTo} />],
              [
                "Search",
                <LibrarySearch
                  url={`${assets}search.tsv`}
                  open={(d) => {
                    const at = { line: d.line - 1, character: 0 };
                    showLocation({ path: d.path }, { start: at, end: at }, d.name);
                  }}
                />,
              ],
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
              keys={keys}
            />
          </div>
          {library && (
            <div className="editor-wrap library">
              <div className="library-bar">
                <span>
                  {library.path} <span className="muted">({library.note ?? "library, read only"})</span>
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
            <Goals
              result={goals?.now ?? null}
              before={goals?.before ?? null}
              hint={toCursor ? "Not checked yet. Alt+Enter checks up to the cursor." : undefined}
            />
          </div>
          <Tabs
            tabs={[
              [
                "Problems",
                <Problems diagnostics={diagnostics} goTo={goTo} depError={depError} />,
                <>
                  Problems
                  {(depError || diagnostics.some((d) => d.severity === 1)) && <span className="badge"> •</span>}
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
