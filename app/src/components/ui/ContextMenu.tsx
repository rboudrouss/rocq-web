// A menu at a point of the page (a right click), closed by a click
// elsewhere or Escape
import { type ReactNode, useEffect, useRef } from "react";
import "./ui.css";

export type MenuItem = { label: string; icon?: ReactNode; action: () => void; danger?: boolean; disabled?: boolean } | "-";

export function ContextMenu({ x, y, items, close }: { x: number; y: number; items: MenuItem[]; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [close]);
  // (inside the window)
  const left = Math.min(x, window.innerWidth - 240);
  const top = Math.min(y, window.innerHeight - 32 * items.length - 16);
  return (
    <div className="context-menu" ref={ref} style={{ left, top }} role="menu">
      {items.map((it, i) =>
        it === "-" ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={it.danger ? "danger" : ""}
            disabled={it.disabled}
            onClick={() => {
              close();
              it.action();
            }}
          >
            <span className="icon">{it.icon}</span>
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}
