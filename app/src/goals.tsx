// The goals at the cursor: Rocq's documents laid out for the panel's
// width, what the sentence changed highlighted (the goals before it), the
// hypotheses folded by a click on their names.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Goal, GoalsResult, Hyp } from "./lsp";
import { added, PpView, type Text } from "./pp";

// The panel's width in characters
function useColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(60);
  useLayoutEffect(() => {
    const el = ref.current!;
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(100);
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    el.appendChild(probe);
    const measure = () => {
      const ch = probe.getBoundingClientRect().width / 100 || 8;
      setColumns(Math.max(20, Math.floor(el.clientWidth / ch) - 2));
    };
    measure();
    const o = new ResizeObserver(measure);
    o.observe(el);
    return () => {
      o.disconnect();
      probe.remove();
    };
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

function GoalView({ goal, before, index, width, diffs, folded, fold }: {
  goal: Goal;
  before?: Goal;
  index: number;
  width: number;
  diffs: boolean;
  folded: Set<string>;
  fold: (name: string) => void;
}) {
  const [open, setOpen] = useState(index === 0);
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
        {index === 0 ? "" : `goal ${index + 1}`}
        {!open && ` (${goal.hyps.length} hypotheses)`}
      </button>
      <div className="concl">
        <PpView text={goal.ty} width={width} highlight={diffs && before ? added(before.ty, goal.ty) : undefined} />
      </div>
    </div>
  );
}

// The goal before the sentence that goal [i] of [n] comes from: the first
// solved, the next ones the same; or the first split into several
function beforeOf(b: Goal[], n: number, i: number): Goal | undefined {
  const d = n - b.length;
  return d >= 0 ? b[Math.max(0, i - d)] : b[i - d];
}

const text = (m: Text | { level: number; text: Text }) => (typeof m === "object" && !Array.isArray(m) ? m.text : m);

// [result]: the goals after the sentence at the cursor, [before]: before it
export function Goals({ result, before }: { result: GoalsResult | null; before: GoalsResult | null }) {
  const [ref, width] = useColumns();
  const [diffs, setDiffs] = useState(() => stored("rocq-web:diffs", true));
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
  const pending = g ? g.stack.reduce((n, [l, r]) => n + l.length + r.length, 0) : 0;
  return (
    <div className="goals-view" ref={ref}>
      {g && g.goals.length > 0 && (
        <label className="diffs muted" title="Highlight what the sentence at the cursor changed">
          <input type="checkbox" checked={diffs} onChange={(e) => setDiffs(e.target.checked)} /> changes
        </label>
      )}
      {!result ? (
        <p className="muted">Move the cursor into a proof.</p>
      ) : g ? (
        g.goals.length > 0 ? (
          g.goals.map((goal, i) => (
            <GoalView
              key={i}
              goal={goal}
              before={b && beforeOf(b, g.goals.length, i)}
              index={i}
              width={width}
              diffs={diffs}
              folded={folded}
              fold={fold}
            />
          ))
        ) : (
          <p className="muted">No goals{pending > 0 && `, ${pending} unfocused`}.</p>
        )
      ) : (
        <p className="muted">Not in a proof.</p>
      )}
      {g && g.shelf.length > 0 && <p className="muted">{g.shelf.length} shelved</p>}
      {g && g.given_up.length > 0 && <p className="muted">{g.given_up.length} given up</p>}
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
