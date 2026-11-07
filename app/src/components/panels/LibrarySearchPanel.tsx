import { useMemo, useState } from "react";

// Search of the libraries' sources: their declarations (search.tsv, from
// scripts/search-index.mjs), downloaded on the first search

export type Declaration = { module: string; path: string; kind: string; name: string; line: number; statement: string };

function parseIndex(text: string): Declaration[] {
  const out: Declaration[] = [];
  let module = "";
  let path = "";
  for (const l of text.split("\n")) {
    if (!l) continue;
    const f = l.split("\t");
    if (l[0] === "@") [module, path] = [f[0].slice(1), f[1]];
    else out.push({ module, path, kind: f[0], name: f[1], line: Number(f[2]), statement: f[3] ?? "" });
  }
  return out;
}

export function LibrarySearchPanel({ url, open }: { url: string; open: (d: Declaration) => void }) {
  const [index, setIndex] = useState<Declaration[] | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const load = () => {
    if (index || loading) return;
    setLoading("Downloading the index of the libraries…");
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(
        (t) => (setIndex(parseIndex(t)), setLoading(null)),
        (e: Error) => setLoading(`The index could not be downloaded (${e.message})`),
      );
  };
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!index || q.length < 2) return [];
    const words = q.split(/\s+/);
    const scored: [number, Declaration][] = [];
    for (const d of index) {
      const name = d.name.toLowerCase();
      const all = `${d.module.toLowerCase()}.${name} ${d.statement.toLowerCase()}`;
      if (!words.every((w) => all.includes(w))) continue;
      // (the name first: the query, its start, in it, the query's words in it)
      const score = name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : words.every((w) => name.includes(w)) ? 3 : 4;
      scored.push([score * 1000 + Math.min(name.length, 999), d]);
    }
    return scored.sort((a, b) => a[0] - b[0]).map(([, d]) => d);
  }, [index, query]);
  return (
    <div className="library-search">
      <input
        placeholder="Search the libraries (add_comm, Nat.le, list rev)"
        value={query}
        onFocus={load}
        onChange={(e) => (load(), setQuery(e.target.value))}
      />
      {loading && <p className="muted">{loading}</p>}
      {index && !query && (
        <p className="muted">
          {index.length} declarations of the libraries' sources, by name and statement. Click one to read its source.
        </p>
      )}
      {index && query.trim().length >= 2 && results.length === 0 && <p className="muted">Nothing found.</p>}
      <ul>
        {results.slice(0, 200).map((d, i) => (
          <li key={i}>
            <button onClick={() => open(d)} title={`${d.path}, line ${d.line}`}>
              <span className="kind">{d.kind}</span> <b>{d.name}</b> <span className="muted">{d.module}</span>
              {d.statement && <div className="statement">{d.statement}</div>}
            </button>
          </li>
        ))}
        {results.length > 200 && <li className="muted">{results.length - 200} more: refine the search</li>}
      </ul>
    </div>
  );
}
