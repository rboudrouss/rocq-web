// On a phone, between the editor and the goals: the moves of the checking
// (the header's buttons), and a grip that shares the height between them
// (the editor's part, [split], given at the end of a drag)
import { type RefObject, useRef } from "react";
import type { Move } from "../../hooks/useDocument";
import { moves } from "./Header";

export function StepBar({ move, main, split }: {
  move: (where: Move) => void;
  // (the column shared: its --split is the editor's part)
  main: RefObject<HTMLElement | null>;
  split: (part: number) => void;
}) {
  const part = useRef<number | null>(null);
  const drag = (e: React.PointerEvent) => {
    const m = main.current;
    if (part.current === null || !m) return;
    const r = m.getBoundingClientRect();
    part.current = Math.min(0.85, Math.max(0.15, (e.clientY - r.top) / r.height));
    m.style.setProperty("--split", `${part.current * 100}%`);
  };
  return (
    <div className="step-bar" role="toolbar" aria-label="Navigation">
      {moves.map(([where, what, Icon]) => (
        <button
          key={where}
          data-move={where}
          // (the editor keeps the focus, or does not take it: the keyboard)
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => move(where)}
          title={what}
          aria-label={what}
        >
          <Icon size={18} />
        </button>
      ))}
      <div
        className="grip"
        title="Drag to share the height between the editor and the goals"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          part.current = -1;
          drag(e);
        }}
        onPointerMove={drag}
        onPointerUp={() => {
          if (part.current !== null && part.current >= 0) split(part.current);
          part.current = null;
        }}
        onPointerCancel={() => (part.current = null)}
      />
    </div>
  );
}
