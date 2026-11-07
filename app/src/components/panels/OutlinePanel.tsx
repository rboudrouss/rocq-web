import { useState } from "react";
import type { DocumentSymbol, Range } from "../../lib/lsp";

// Outline: coq-lsp's document symbols

const kinds: Record<number, string> = { 2: "module", 5: "class", 6: "method", 12: "function", 13: "variable", 23: "struct" };

function flatten(symbols: DocumentSymbol[], depth = 0): [DocumentSymbol, number][] {
  return symbols.flatMap((s) => [[s, depth] as [DocumentSymbol, number], ...flatten(s.children ?? [], depth + 1)]);
}

export function OutlinePanel({ symbols, goTo }: { symbols: DocumentSymbol[]; goTo: (r: Range) => void }) {
  const [filter, setFilter] = useState("");
  const shown = flatten(symbols).filter(([s]) => s.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="outline">
      <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {shown.length === 0 && <p className="muted">No definitions.</p>}
      <ul>
        {shown.map(([s, depth], i) => (
          <li key={i} style={{ paddingLeft: `${depth}rem` }}>
            <button onClick={() => goTo(s.selectionRange ?? s.range)}>
              <span className={`kind kind-${s.kind}`}>{s.detail || kinds[s.kind] || ""}</span> {s.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
