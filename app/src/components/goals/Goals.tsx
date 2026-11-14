// The goals at the cursor: Rocq's documents laid out for the panel's
// width, what the sentence changed highlighted (the goals before it), the
// hypotheses folded by a click on their names.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Goal, GoalsResult, Hyp } from "../../lib/lsp";
import { added, type Text } from "../../lib/pp";
import { PpView } from "./Pp";

// The panel's width in characters
function useColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(60);
  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => {
      const ctx = document.createElement("canvas").getContext("2d");
      if (ctx) ctx.font = getComputedStyle(el).font;
      const ch = (ctx?.measureText("0".repeat(100)).width ?? 800) / 100 || 8;
      setColumns(Math.max(20, Math.floor(el.clientWidth / ch) - 2));
    };
    measure();
    const o = new ResizeObserver(measure);
    o.observe(el);
    return () => o.disconnect();
  }, []);
  return [ref, columns] as const;
}

const stored = (key: string, d: boolean) => {
  const v = localStorage.getItem(key);
  return v === null ? d : v === "1";
};

function HypView({ hyp, before, width, diffs, folded, fold }: {
  hyp: Hyp;
  before?: Hyp;
  width: number;
  diffs: boolean;
  folded: boolean;
  fold: () => void;
}) {
  const names = hyp.names.join(", ");
  const isNew = diffs && before === undefined;
  return (
    <div className={"hyp" + (isNew ? " diff-new" : "")}>
      <button className="hyp-name" onClick={fold} title={folded ? "Show its type" : "Fold its type"}>
        {names}
      </button>
      {folded ? (
        <span className="muted"> …</span>
      ) : (
        <>
          {hyp.def != null && (
            <>
              {" := "}
              <PpView text={hyp.def} width={width} start={names.length + 4} highlight={diffs && before ? added(before.def ?? undefined, hyp.def) : undefined} />
            </>
          )}
          {" : "}
          <PpView text={hyp.ty} width={width} start={names.length + 3} highlight={diffs && before ? added(before.ty, hyp.ty) : undefined} />
        </>
      )}
    </div>
  );
}

// (open: its hypotheses shown at first, as RocqIDE those of the first goal
// only)
function GoalView({ goal, before, index, total, open: opened, width, diffs, folded, fold }: {
  goal: Goal;
  before?: Goal;
  index: number;
  total: number;
  open: boolean;
  width: number;
  diffs: boolean;
  folded: Set<string>;
  fold: (name: string) => void;
}) {
  const [open, setOpen] = useState(opened);
  const prev = new Map((before?.hyps ?? []).flatMap((h) => h.names.map((n) => [n, h] as const)));
  return (
    <div className="goal">
      {open &&
        goal.hyps.map((h, i) => (
          <HypView
            key={i}
            hyp={h}
            before={before ? prev.get(h.names[0]) : undefined}
            width={width}
            diffs={diffs && !!before}
            folded={folded.has(h.names.join(","))}
            fold={() => fold(h.names.join(","))}
          />
        ))}
      <button className="bar" onClick={() => setOpen(!open)} title={open ? "Hide its hypotheses" : "Show its hypotheses"}>
        ({index + 1}/{total})
        {!open && goal.hyps.length > 0 && ` ${goal.hyps.length} hypotheses`}
      </button>
      <div className="concl">
        <PpView text={goal.ty} width={width} highlight={diffs && before ? added(before.ty, goal.ty) : undefined} />
      </div>
    </div>
  );
}

// The goal before the sentence that goal [i] of [n] comes from: the first
// solved, the next ones the same; or the first split into several
export function beforeOf(b: Goal[], n: number, i: number): Goal | undefined {
  const d = n - b.length;
  return d >= 0 ? b[Math.max(0, i - d)] : b[i - d];
}

const text = (m: Text | { level: number; text: Text }) => (typeof m === "object" && !Array.isArray(m) ? m.text : m);

// [result]: the goals after a sentence, [before]: before it (hint: shown
// without goals; error: the one the checking stopped before)
export function Goals({ result, before, hint, error }: {
  result: GoalsResult | null;
  before: GoalsResult | null;
  hint?: string;
  error?: string | null;
}) {
  const [ref, width] = useColumns();
  // (off by default, as in RocqIDE)
  const [diffs, setDiffs] = useState(() => stored("rocq-web:diffs", false));
  const [folded, setFolded] = useState(new Set<string>());
  useEffect(() => localStorage.setItem("rocq-web:diffs", diffs ? "1" : "0"), [diffs]);
  const fold = (name: string) =>
    setFolded((f) => {
      const g = new Set(f);
      if (!g.delete(name)) g.add(name);
      return g;
    });
  const g = result?.goals;
  const b = before?.goals?.goals;
  // the unfocused goals, as RocqIDE: those of the innermost focus first
  const unfocused = g ? g.stack.flatMap(([l, r]) => [...l, ...r]) : [];
  const view = (goals: Goal[], focused: boolean) =>
    goals.map((goal, i) => (
      <GoalView
        key={(focused ? "focused " : "unfocused ") + i}
        goal={goal}
        before={focused && b ? beforeOf(b, goals.length, i) : undefined}
        index={i}
        total={goals.length}
        open={focused && i === 0}
        width={width}
        diffs={diffs && focused}
        folded={folded}
        fold={fold}
      />
    ));
  return (
    <div className="goals-view" ref={ref}>
      {g && g.goals.length > 0 && (
        <label className="diffs muted" title="Highlight what the last sentence changed">
          <input type="checkbox" checked={diffs} onChange={(e) => setDiffs(e.target.checked)} /> changes
        </label>
      )}
      {!result ? (
        <p className="muted">{hint ?? "Move the cursor into a proof."}</p>
      ) : g ? (
        g.goals.length > 0 ? (
          <>
            <p className="muted goals-count">
              {g.goals.length} goal{g.goals.length > 1 && "s"}
            </p>
            {view(g.goals, true)}
          </>
        ) : unfocused.length > 0 ? (
          <>
            <p className="muted goals-count">This subproof is complete, but there are some unfocused goals:</p>
            {view(unfocused, false)}
          </>
        ) : (
          <p className="muted">No more goals.</p>
        )
      ) : (
        <p className="muted">Not in a proof.</p>
      )}
      {g && g.shelf.length > 0 && <p className="muted">{g.shelf.length} shelved</p>}
      {g && g.given_up.length > 0 && <p className="muted">{g.given_up.length} given up</p>}
      {error && <pre className="error" data-testid="stopped">{error}</pre>}
      {result?.error && (
        <pre className="error">
          <PpView text={result.error} width={width} />
        </pre>
      )}
      {result?.messages.map((m, i) => (
        <pre className="message" key={i}>
          <PpView text={text(m)} width={width} />
        </pre>
      ))}
    </div>
  );
}
