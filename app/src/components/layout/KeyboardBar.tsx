// On a phone, the keyboard open: over it the goals on a line (a tap shows
// them all, the keyboard closed), the moves of the checking and the
// symbols of Rocq a phone's keyboard hides
import { ArrowDown, ArrowRightToLine, ArrowUp } from "lucide-react";
import type { Move } from "../../hooks/useDocument";
import type { GoalsResult } from "../../lib/lsp";
import { beforeOf } from "../goals/Goals";
import { flat } from "../../lib/pp";

const symbols = [".", ";", ":", ":=", "->", "=>", "|", "_", "(", ")", "[", "]", "{", "}", "'", "*", "+", "=", "<>", "%", "\\"];
const keyMoves: [Move, string, typeof ArrowDown][] = [
  ["previous", "Back one sentence", ArrowUp],
  ["next", "Check the next sentence", ArrowDown],
  ["cursor", "Check up to the cursor", ArrowRightToLine],
];

const line = (s: string) => s.replace(/\s+/g, " ").trim();

// The goals on a line: the error the checking stopped at, else the
// conclusion of the first goal, the hypotheses the last sentence added and
// the number of goals; else a message (Check, Compute...)
function Peek({ result, before, error, hint }: {
  result: GoalsResult | null;
  before: GoalsResult | null;
  error: string | null;
  hint: string;
}) {
  const g = result?.goals;
  const problem = error ?? (result?.error ? flat(result.error) : null);
  if (problem) return <span className="line error">{line(problem)}</span>;
  const message = result?.messages[0];
  const said = message && line(flat(typeof message === "object" && !Array.isArray(message) ? message.text : message));
  if (!g || g.goals.length === 0) {
    const unfocused = g ? g.stack.reduce((n, [l, r]) => n + l.length + r.length, 0) : 0;
    const what = !result ? hint : !g ? "Not in a proof" : unfocused ? `Subproof complete, ${unfocused} unfocused` : "No more goals";
    return <span className={said ? "line" : "line muted"}>{said || what}</span>;
  }
  const first = g.goals[0];
  const b = before?.goals?.goals;
  const prev = b && beforeOf(b, g.goals.length, 0);
  const had = new Set(prev?.hyps.flatMap((h) => h.names));
  const added = prev ? first.hyps.flatMap((h) => h.names).filter((n) => !had.has(n)) : [];
  return (
    <>
      <span className="turnstile">⊢</span>
      <span className="line">{line(flat(first.ty))}</span>
      {added.length > 0 && <span className="pill">+{added.length > 2 ? `${added.length} hyps` : added.join(" ")}</span>}
      <span className="pill">
        {g.goals.length} goal{g.goals.length > 1 && "s"}
      </span>
    </>
  );
}

export function KeyboardBar({ result, before, error, hint, move, insert }: {
  result: GoalsResult | null;
  before: GoalsResult | null;
  error: string | null;
  hint: string;
  move: (where: Move) => void;
  insert: (text: string) => void;
}) {
  // (the buttons do not take the focus: the keyboard stays)
  const keep = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div className="keyboard-bar">
      <button
        className="peek"
        data-testid="peek"
        title="All the goals (the keyboard closed)"
        onMouseDown={keep}
        onClick={() => (document.activeElement as HTMLElement | null)?.blur()}
      >
        <Peek result={result} before={before} error={error} hint={hint} />
      </button>
      <div className="keys" role="toolbar" aria-label="Keys">
        {keyMoves.map(([where, what, Icon]) => (
          <button key={where} className="move" data-move={where} title={what} aria-label={what} onMouseDown={keep} onClick={() => move(where)}>
            <Icon size={16} />
          </button>
        ))}
        {symbols.map((s) => (
          <button key={s} onMouseDown={keep} onClick={() => insert(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
