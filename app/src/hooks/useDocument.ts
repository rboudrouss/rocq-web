// The file open in the editor as a document of coq-lsp: opened after the
// files it requires are compiled (lib/project.ts), its changes, its
// diagnostics, outline, goals at the cursor (and before the sentence
// there), checking as it changes or up to the cursor (Alt+Enter), the
// moves to the next sentence or problem, hover and completion; the files
// Rocq wrote in the workspace (Extraction...).
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorHandle } from "../components/editor/Editor";
import type { CompletionItem, Diagnostic, DocumentSymbol, GoalsResult, Position } from "../lib/lsp";
import { offsetAt, positionAt, sentenceAt, sentences } from "../lib/sentences";
import { isProject, isRocq } from "../lib/storage";
import { workerUri } from "../lib/workspaces";
import type { Session } from "./useRocqSession";
import type { Workspace } from "./useWorkspace";

export type Goals = { now: GoalsResult; before: GoalsResult | null };

export function useDocument({
  session,
  ws,
  editor,
  log,
}: {
  session: Session;
  ws: Workspace;
  editor: RefObject<EditorHandle | null>;
  log: (m: string) => void;
}) {
  const [goals, setGoals] = useState<Goals | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [symbols, setSymbols] = useState<DocumentSymbol[]>([]);
  // why the files the document requires were not compiled
  const [depError, setDepError] = useState<string | null>(null);
  // the files Rocq wrote in the workspace (Extraction...): [path, size]
  const [produced, setProduced] = useState<[string, number][]>([]);
  // Rocq checks the file up to the cursor on request (Alt+Enter), not all
  // of it as it changes
  const [toCursor, setToCursor] = useState(() => localStorage.getItem("rocq-web:check") === "cursor");
  session.checkOnRequest.current = toCursor;

  const { client, ready, project } = session;
  const active = ws.active;
  const activeRef = useRef(active);
  activeRef.current = active;
  const version = useRef(1);
  const cursor = useRef<Position>({ line: 0, character: 0 });
  // (checking up to the cursor) the offset Rocq checked the file up to
  const checkedTo = useRef(0);
  const diagnosticsRef = useRef<Diagnostic[]>([]);
  const toCursorRef = useRef(toCursor);
  toCursorRef.current = toCursor;
  const read = ws.read;

  const askGoals = useCallback(() => {
    const c = client.current;
    if (!c || !ready.current || !isRocq(activeRef.current)) return;
    const v = version.current;
    const name = activeRef.current;
    const uri = workerUri(name);
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
  }, [client, ready, read, log]);

  const askSymbols = useCallback(() => {
    const c = client.current;
    if (!c || !ready.current || !isRocq(activeRef.current)) return;
    const name = activeRef.current;
    c.symbols(workerUri(name)).then(
      (s) => name === activeRef.current && setSymbols(s ?? []),
      () => {},
    );
  }, [client, ready]);

  // (not Rocq's, nor the user's)
  const listProduced = useCallback(() => {
    const c = client.current;
    if (!c) return;
    c.listFiles("/workspace").then(
      (fs) => {
        const mine = new Set(ws.current.current.files);
        setProduced(
          fs
            .map(([p, size]) => [p.replace(/^\/workspace\//, ""), size] as [string, number])
            .filter(([p]) => !mine.has(p) && !/\.(vo|vos|vok|glob|aux|v)$|(^|\/)\.[^/]*$/.test(p) && !isProject(p))
            .sort(),
        );
      },
      () => {},
    );
  }, [client, ws]);

  // Opens the document, after the files it requires
  const open = useCallback(
    async (name: string) => {
      const c = client.current;
      if (!c || !isRocq(name)) return;
      // (in its workspace, once coq-lsp has it)
      await session.whenSynced();
      try {
        await project.current!.prepare(name);
        setDepError(null);
      } catch (e) {
        log((e as Error).message);
        setDepError((e as Error).message);
      }
      if (name !== activeRef.current || c !== client.current) return;
      c.open(workerUri(name), read(name), ++version.current);
    },
    [client, project, read, log, session],
  );

  // The document open in coq-lsp: [file, client]
  const opened = useRef<{ name: string; client: unknown } | null>(null);
  useEffect(() => {
    const c = client.current;
    if (!c || !ready.current) return;
    const o = opened.current;
    if (o && o.client === c && o.name === active) return;
    if (o && o.client === c && isRocq(o.name)) {
      c.close(workerUri(o.name));
      // (what coq-lsp keeps of the file and of the states it went through)
      c.notify("coq/trimCaches", {});
    }
    opened.current = { name: active, client: c };
    setGoals(null);
    setDepError(null);
    setDiagnostics([]);
    diagnosticsRef.current = [];
    setSymbols([]);
    cursor.current = { line: 0, character: 0 };
    checkedTo.current = 0;
    open(active);
  }, [active, session.started, client, ready, open]);

  // What the session reports for the document
  useEffect(() => {
    session.events.current = {
      diagnostics: (u, _v, ds) => {
        if (u !== workerUri(activeRef.current)) return;
        editor.current?.setDiagnostics(ds);
        diagnosticsRef.current = ds;
        setDiagnostics(ds);
      },
      progress: (u, rs) => u === workerUri(activeRef.current) && editor.current?.setProcessing(rs),
      idle: () => {
        askGoals();
        askSymbols();
        listProduced();
      },
      workspacesChanged: () => {
        const c = client.current;
        const name = activeRef.current;
        if (!c || !isRocq(name)) return;
        c.close(workerUri(name));
        open(name);
      },
    };
  }, [session.events, editor, askGoals, askSymbols, listProduced, client, open]);

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
      ws.edit(name, t);
      version.current++;
      if (!ready.current || !isRocq(name)) return;
      client.current?.change(workerUri(name), t, version.current);
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
    [client, ready, project, read, ws, editor, log],
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
    [askGoals, read, editor],
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
    [checkTo, read, editor],
  );

  // The cursor on the next problem, or the previous one
  const problem = useCallback(
    (p: Position, forward: boolean) => {
      const ds = diagnosticsRef.current.filter((d) => d.severity <= 2);
      if (ds.length === 0) return;
      const key = (q: Position) => q.line * 1e6 + q.character;
      const sorted = [...ds].sort((a, b) => key(a.range.start) - key(b.range.start));
      const k = key(p);
      const d = forward
        ? (sorted.find((d) => key(d.range.start) > k) ?? sorted[0])
        : (sorted.filter((d) => key(d.range.start) < k).pop() ?? sorted[sorted.length - 1]);
      editor.current?.goTo(d.range);
    },
    [editor],
  );

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

  const changeMode = useCallback(
    (cursorMode: boolean) => {
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
        c.change(workerUri(name), text, ++version.current);
      }
    },
    [client, ready, read, editor],
  );

  const hover = useCallback(
    (p: Position) =>
      ready.current && client.current && isRocq(activeRef.current)
        ? client.current.hover(workerUri(activeRef.current), p)
        : Promise.resolve(null),
    [client, ready],
  );
  const complete = useCallback(
    async (p: Position): Promise<CompletionItem[]> => {
      if (!ready.current || !client.current || !isRocq(activeRef.current)) return [];
      const r = await client.current.completion(workerUri(activeRef.current), p);
      return Array.isArray(r) ? r : (r?.items ?? []);
    },
    [client, ready],
  );

  return {
    goals,
    diagnostics,
    symbols,
    depError,
    produced,
    toCursor,
    changeMode,
    onChange,
    onCursor,
    keys,
    hover,
    complete,
    // the document's version and the cursor (queries at the cursor)
    version,
    cursor,
  };
}

export type Document = ReturnType<typeof useDocument>;
