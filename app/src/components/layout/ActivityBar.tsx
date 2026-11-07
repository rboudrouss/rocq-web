// The icons on the left: which panel the sidebar shows, a click on the
// one shown closing it
import { Files, ListTree, Package, Search } from "lucide-react";
import type { ReactNode } from "react";
import "./layout.css";

export type PanelId = "files" | "outline" | "search" | "packages";

export const panels: { id: PanelId; title: string; icon: ReactNode }[] = [
  { id: "files", title: "Files", icon: <Files size={20} /> },
  { id: "outline", title: "Outline", icon: <ListTree size={20} /> },
  { id: "search", title: "Search", icon: <Search size={20} /> },
  { id: "packages", title: "Packages", icon: <Package size={20} /> },
];

export function ActivityBar({
  shown,
  show,
  badges = {},
}: {
  shown: PanelId | null;
  show: (p: PanelId | null) => void;
  badges?: Partial<Record<PanelId, ReactNode>>;
}) {
  return (
    <nav className="activity" aria-label="Panels">
      {panels.map((p) => (
        <button
          key={p.id}
          className={shown === p.id ? "on" : ""}
          title={shown === p.id ? `${p.title} (click to close)` : p.title}
          aria-label={p.title}
          aria-pressed={shown === p.id}
          onClick={() => show(shown === p.id ? null : p.id)}
        >
          {p.icon}
          {badges[p.id] !== undefined && <span className="activity-badge">{badges[p.id]}</span>}
        </button>
      ))}
    </nav>
  );
}
