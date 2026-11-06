import { useCallback, useEffect, useRef, useState } from "react";
import { pickBuild } from "./detect";
import { Editor, type EditorHandle } from "./Editor";
import { type CompletionItem, type Goal, type GoalsResult, LspClient, type Position } from "./lsp";

const uri = "file:///workspace/scratch.v";
const storageKey = "rocq-web:scratch.v";

const example = `(* Rocq in the browser *)
Theorem plus_comm : forall n m : nat, n + m = m + n.
Proof.
  intros n m. induction n as [|n IH]; simpl.
  - rewrite <- plus_n_O. reflexivity.
  - rewrite IH. apply plus_n_Sm.
Qed.

From Ltac2 Require Import Ltac2.
Ltac2 Eval List.length [1; 2; 3].
`;

function GoalView({ goal, index }: { goal: Goal; index: number }) {
  return (
    <div className="goal">
      {index === 0 &&
        goal.hyps.map((h, i) => (
          <div className="hyp" key={i}>
            <b>{h.names.join(", ")}</b>
            {h.def != null && <> := {h.def}</>} : {h.ty}
          </div>
        ))}
      <div className="bar">{index === 0 ? "" : `goal ${index + 1}`}</div>
      <div className="concl">{goal.ty}</div>
    </div>
  );
}

function Goals({ result }: { result: GoalsResult | null }) {
  if (!result) return <p className="muted">Move the cursor into a proof.</p>;
  const goals = result.goals?.goals;
  const messages = result.messages.map((m) => (typeof m === "string" ? m : m.text));
  return (
    <>
      {result.goals ? (
        goals && goals.length > 0 ? (
          goals.map((g, i) => <GoalView goal={g} index={i} key={i} />)
        ) : (
          <p className="muted">No goals.</p>
        )
      ) : (
        <p className="muted">Not in a proof.</p>
      )}
      {result.error && <pre className="error">{result.error}</pre>}
      {messages.map((m, i) => (
        <pre className="message" key={i}>
          {m}
        </pre>
      ))}
    </>
  );
}

// The document of the previous visit, else the example
const initial = localStorage.getItem(storageKey) ?? example;

export function App() {
  const [build] = useState(pickBuild);
  const [status, setStatus] = useState("starting");
  const [goals, setGoals] = useState<GoalsResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const client = useRef<LspClient | null>(null);
  const editor = useRef<EditorHandle>(null);
  const version = useRef(1);
  const cursor = useRef<Position>({ line: 0, character: 0 });
  const ready = useRef(false);
  const text = useRef(initial);

  const askGoals = useCallback(() => {
    const c = client.current;
    if (!c || !ready.current) return;
    const v = version.current;
    c.goals(uri, v, cursor.current).then(
      (r) => v === version.current && setGoals(r),
      (e: Error) => setLogs((l) => [...l, `goals: ${e.message}`]),
    );
  }, []);

  useEffect(() => {
    const c = new LspClient(`/rocq/worker.js?build=${build}`, {
      diagnostics: (u, _v, ds) => u === uri && editor.current?.setDiagnostics(ds),
      status: (s) => {
        setStatus(s);
        if (s === "Idle") askGoals();
      },
      progress: (u, rs) => u === uri && editor.current?.setProcessing(rs),
      log: (m) => setLogs((l) => [...l.slice(-50), m]),
    });
    client.current = c;
    (window as unknown as { rocq: LspClient }).rocq = c;
    const t0 = performance.now();
    c.initialize().then(() => {
      setLogs((l) => [...l, `server ready in ${Math.round(performance.now() - t0)} ms`]);
      ready.current = true;
      c.open(uri, text.current, version.current);
    });
    return () => c.terminate();
  }, [build, askGoals]);

  const timer = useRef<number | undefined>(undefined);
  const save = useRef<number | undefined>(undefined);
  const onChange = useCallback((t: string) => {
    text.current = t;
    version.current++;
    if (ready.current) client.current?.change(uri, t, version.current);
    window.clearTimeout(save.current);
    save.current = window.setTimeout(() => localStorage.setItem(storageKey, t), 500);
  }, []);
  const hover = useCallback(
    (p: Position) => (ready.current && client.current ? client.current.hover(uri, p) : Promise.resolve(null)),
    [],
  );
  const complete = useCallback(async (p: Position): Promise<CompletionItem[]> => {
    if (!ready.current || !client.current) return [];
    const r = await client.current.completion(uri, p);
    return Array.isArray(r) ? r : (r?.items ?? []);
  }, []);
  const onCursor = useCallback(
    (p: Position) => {
      cursor.current = p;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(askGoals, 150);
    },
    [askGoals],
  );

  return (
    <div className="app">
      <header>
        <h1>rocq-web</h1>
        <span className="status" data-status={status}>
          {status}
        </span>
        <span className="muted">build: {build}</span>
      </header>
      <main>
        <Editor
          ref={editor}
          initial={initial}
          onChange={onChange}
          onCursor={onCursor}
          hover={hover}
          complete={complete}
        />
        <aside>
          <h2>Goals</h2>
          <div className="goals" data-testid="goals">
            <Goals result={goals} />
          </div>
          <h2>Log</h2>
          <div className="log">
            {logs.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </aside>
      </main>
    </div>
  );
}
