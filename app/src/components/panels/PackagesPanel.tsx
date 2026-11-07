import { useMemo, useState } from "react";

// Packages: scripts/assets.mjs's packages.json

export type Package = {
  name: string;
  version: string;
  synopsis: string;
  homepage?: string;
  depends: string[];
  modules: string[];
};

export const requireLine = (module: string) => {
  const [root, ...rest] = module.split(".");
  return rest.length ? `From ${root} Require Import ${rest.join(".")}.` : `Require Import ${root}.`;
};

export function PackagesPanel({ packages, insert }: { packages: Package[] | null; insert: (line: string) => void }) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const f = filter.toLowerCase();
    return (packages ?? [])
      .map((p) => {
        const own = !f || p.name.includes(f) || p.synopsis.toLowerCase().includes(f);
        const modules = own ? p.modules : p.modules.filter((m) => m.toLowerCase().includes(f));
        return { p, modules, open: !!f && !own };
      })
      .filter((x) => x.modules.length > 0);
  }, [packages, filter]);
  if (!packages) return <p className="muted">Loading…</p>;
  return (
    <div className="packages">
      <input placeholder="Search packages and modules" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <p className="muted">
        {packages.length} packages. Click a module to insert its <code>Require</code>. Its files are downloaded when Rocq
        loads it.
      </p>
      {shown.map(({ p, modules, open }) => (
        <details key={p.name} open={open || undefined}>
          <summary>
            <b>{p.name}</b> <span className="muted">{p.version}</span>
            <div className="synopsis">{p.synopsis}</div>
          </summary>
          {p.homepage && (
            <a href={p.homepage} target="_blank" rel="noreferrer">
              {p.homepage}
            </a>
          )}
          {p.depends.length > 0 && <div className="muted">needs {p.depends.join(", ")}</div>}
          <ul className="modules">
            {modules.slice(0, 300).map((m) => (
              <li key={m}>
                <button title={requireLine(m)} onClick={() => insert(requireLine(m))}>
                  {m}
                </button>
              </li>
            ))}
            {modules.length > 300 && <li className="muted">{modules.length - 300} more: refine the search</li>}
          </ul>
        </details>
      ))}
    </div>
  );
}
