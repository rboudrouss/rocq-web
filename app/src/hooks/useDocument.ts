// The file open in the editor as a document of coq-lsp: opened after the
// files it requires are compiled (lib/project.ts), its changes, its
// diagnostics, outline, goals (and before the sentence they follow),
// checked step by step or as it changes, the moves to the next sentence or
// problem, hover and completion; the files Rocq wrote in the workspace
// (Extraction...).
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorHandle } from "../components/editor/Editor";
import { navKey } from "../lib/keys";
import type { CompletionItem, Diagnostic, DocumentSymbol, GoalsResult, Position } from "../lib/lsp";
import { offsetAt, positionAt, type Sentence, sentenceAt, sentences } from "../lib/sentences";
import { isProject, isRocq } from "../lib/storage";
import { workerUri } from "../lib/workspaces";
import type { Session } from "./useRocqSession";
import type { Workspace } from "./useWorkspace";

export type Goals = { now: GoalsResult; before: GoalsResult | null };

// Where the checking goes: the next sentence, the previous one, the
// cursor, the start, the end
export type Move = "next" | "previous" | "cursor" | "start" | "end";

// The end of the sentences up to the cursor at [o]: of the sentence it is
// in, else of the last one before it
function upTo(list: Sentence[], o: number) {
  const s = list.find((s) => s.end >= o);
  if (s && s.start < o) return s.end;
  return list.reduce((e, s) => (s.end <= o ? s.end : e), 0);
}

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
  // Step by step, RocqIDE's way (the default): Rocq checks the file up to a
  // point moved a sentence at a time or to the cursor, the goals are those
  // there; else it checks all of it as it changes, the goals are those at
  // the cursor
  const [stepByStep, setStepByStep] = useState(() => localStorage.getItem("rocq-web:check") !== "all");
  // (step by step) the error the checking stopped before
  const [stopped, setStopped] = useState<string | null>(null);
  session.checkOnRequest.current = stepByStep;

  const { client, ready, project } = session;
  const active = ws.active;
  const activeRef = useRef(active);
  activeRef.current = active;
  const version = useRef(1);
  const cursor = useRef<Position>({ line: 0, character: 0 });
  // (step by step) the offset Rocq checked the file up to
  const checkedTo = useRef(0);
  const diagnosticsRef = useRef<Diagnostic[]>([]);
  // (the version of the document they are for)
  const diagnosticsVersion = useRef(0);
  const stepRef = useRef(stepByStep);
  stepRef.current = stepByStep;
  const read = ws.read;

  const askGoals = useCallback(() => {
    const c = client.current;
    if (!c || !ready.current || !isRocq(activeRef.current)) return;
    const v = version.current;
    const name = activeRef.current;
    const uri = workerUri(name);
    const text = read(name);
    // (step by step, where the checking is)
    const step = stepRef.current;
    const to = checkedTo.current;
    if (step && to === 0) return setGoals(null);
    const at = step ? positionAt(text, to) : cursor.current;
    // (the answer for the point where it still is)
    const current = () =>
      v === version.current &&
      name === activeRef.current &&
      step === stepRef.current &&
      (step ? to === checkedTo.current : at === cursor.current);
    c.goals(uri, v, at).then(
      async (now) => {
        if (!current()) return;
        // (before the sentence: at its start)
        const s = sentenceAt(sentences(text), offsetAt(text, at));
        const before = s ? await c.goals(uri, v, positionAt(text, s.start), "Prev").catch(() => null) : null;
        if (current()) setGoals({ now, before });
      },
      (e: Error) => log(`goals: ${e.message}`),
    );
  }, [client, ready, read, log]);

  // (step by step) [to], or the end of the sentence before the first error
  // before it (known once Rocq checked there: the diagnostics of this
  // version), and the error
  const stopBefore = useCallback((text: string, to: number): [number, string | null] => {
    if (diagnosticsVersion.current !== version.current) return [to, null];
    let first: [number, string] | null = null;
    for (const d of diagnosticsRef.current) {
      if (d.severity !== 1) continue;
      const o = offsetAt(text, d.range.start);
      if (o < to && (!first || o < first[0])) first = [o, d.message];
    }
    if (!first) return [to, null];
    const at = first[0];
    return [sentences(text).reduce((e, s) => (s.end <= at ? s.end : e), 0), first[1]];
  }, []);

  // (step by step) where the last move put the cursor (offset)
  const placed = useRef(-1);
  // (step by step) Checks up to [to], stopping before an error, shows the
  // goals there; the cursor there too (move, or it is where the last move
  // put it: the error found once there)
  const checkUpTo = useCallback(
    (to: number, move: boolean) => {
      const text = read(activeRef.current);
      const [end, error] = stopBefore(text, to);
      checkedTo.current = end;
      setStopped(error);
      editor.current?.setChecked(positionAt(text, end));
      if (move || offsetAt(text, cursor.current) === placed.current) {
        editor.current?.goTo(positionAt(text, end), false);
        placed.current = end;
      }
      askGoals();
    },
    [read, stopBefore, editor, askGoals],
  );

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
    }
    opened.current = { name: active, client: c };
    setGoals(null);
    setDepError(null);
    setDiagnostics([]);
    diagnosticsRef.current = [];
    setSymbols([]);
    cursor.current = { line: 0, character: 0 };
    checkedTo.current = 0;
    setStopped(null);
    editor.current?.setChecked(stepRef.current ? { line: 0, character: 0 } : null);
    open(active);
  }, [active, session.started, client, ready, open, editor]);

  // What the session reports for the document
  useEffect(() => {
    session.events.current = {
      diagnostics: (u, v, ds) => {
        if (u !== workerUri(activeRef.current)) return;
        editor.current?.setDiagnostics(ds);
        diagnosticsRef.current = ds;
        diagnosticsVersion.current = v;
        setDiagnostics(ds);
        // (step by step) an error where it was checked up to: stopped before
        if (stepRef.current && v === version.current && stopBefore(read(activeRef.current), checkedTo.current)[1])
          checkUpTo(checkedTo.current, false);
      },
      progress: (u, rs) => {
        if (u !== workerUri(activeRef.current)) return;
        // (step by step, coq-lsp gives the rest of the file, checked up to
        // the point only)
        if (stepRef.current) {
          const text = read(activeRef.current);
          const to = positionAt(text, checkedTo.current);
          const before = (a: Position, b: Position) => a.line < b.line || (a.line === b.line && a.character < b.character);
          rs = rs.filter((r) => before(r.start, to)).map((r) => (before(to, r.end) ? { start: r.start, end: to } : r));
        }
        editor.current?.setProcessing(rs);
      },
      idle: () => {
        // (nothing being checked)
        editor.current?.setProcessing([]);
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
  }, [session.events, editor, askGoals, askSymbols, listProduced, client, open, read, stopBefore, checkUpTo]);

  const depsTimer = useRef<number | undefined>(undefined);
  const goalsTimer = useRef<number | undefined>(undefined);
  const onChange = useCallback(
    (t: string) => {
      const name = activeRef.current;
      let retracted = false;
      if (stepRef.current) {
        // checked up to the sentence before the change
        const old = read(name);
        let d = 0;
        while (d < t.length && d < old.length && t[d] === old[d]) d++;
        if (d < checkedTo.current) {
          checkedTo.current = sentences(t).reduce((e, s) => (s.end <= d ? s.end : e), 0);
          editor.current?.setChecked(positionAt(t, checkedTo.current));
          retracted = true;
        }
        setStopped(null);
      }
      ws.edit(name, t);
      version.current++;
      if (!ready.current || !isRocq(name)) return;
      client.current?.change(workerUri(name), t, version.current);
      if (retracted) {
        window.clearTimeout(goalsTimer.current);
        goalsTimer.current = window.setTimeout(askGoals, 150);
      }
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
    [client, ready, project, read, ws, editor, log, askGoals],
  );

  // (step by step, the goals stay where the checking is)
  const onCursor = useCallback(
    (p: Position) => {
      cursor.current = p;
      if (stepRef.current) return;
      window.clearTimeout(goalsTimer.current);
      goalsTimer.current = window.setTimeout(askGoals, 150);
    },
    [askGoals],
  );

  // Step by step, moves the point checked up to (the cursor following it,
  // but to the cursor); else the cursor, the goals following it
  const move = useCallback(
    (where: Move, p: Position = cursor.current) => {
      const text = read(activeRef.current);
      const list = sentences(text);
      const step = stepRef.current;
      const o = offsetAt(text, p);
      const from = step ? checkedTo.current : o;
      const to =
        where === "next"
          ? (list.find((s) => s.end > from)?.end ?? from)
          : where === "previous"
            ? (list.filter((s) => s.end < from).pop()?.end ?? 0)
            : where === "cursor"
              ? upTo(list, o)
              : where === "start"
                ? 0
                : (list.at(-1)?.end ?? 0);
      if (step) return checkUpTo(to, where !== "cursor");
      if (where !== "cursor") editor.current?.goTo(positionAt(text, to), false);
      else askGoals();
    },
    [read, checkUpTo, askGoals, editor],
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
      [navKey("ArrowDown")]: (p: Position) => move("next", p),
      [navKey("ArrowUp")]: (p: Position) => move("previous", p),
      [navKey("ArrowRight")]: (p: Position) => move("cursor", p),
      [navKey("Home")]: (p: Position) => move("start", p),
      [navKey("End")]: (p: Position) => move("end", p),
      "Alt-Enter": (p: Position) => move("cursor", p),
      "Ctrl-Enter": (p: Position) => move("cursor", p),
      "Alt-n": (p: Position) => move("next", p),
      "Alt-p": (p: Position) => move("previous", p),
      F8: (p: Position) => problem(p, true),
      "Shift-F8": (p: Position) => problem(p, false),
    }),
    [move, problem],
  );

  const changeMode = useCallback(
    (step: boolean) => {
      setStepByStep(step);
      stepRef.current = step;
      setStopped(null);
      localStorage.setItem("rocq-web:check", step ? "step" : "all");
      const c = client.current;
      if (!c || !ready.current) return;
      c.configure(step);
      const name = activeRef.current;
      const text = read(name);
      if (step) {
        // checked up to the cursor
        checkUpTo(upTo(sentences(text), offsetAt(text, cursor.current)), false);
      } else {
        editor.current?.setChecked(null);
        // checks it all again
        c.change(workerUri(name), text, ++version.current);
      }
    },
    [client, ready, read, editor, checkUpTo],
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
    stepByStep,
    changeMode,
    stopped,
    move,
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
