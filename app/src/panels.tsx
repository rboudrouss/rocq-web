// The panels around the editor: files, outline, packages (left),
// problems, queries and the log (right; the goals: src/goals.tsx).
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { canOpenFolder, isOnDisk, isRocq, openFolder, projectFile, validName } from "./files";
import type { Diagnostic, DocumentSymbol, Range } from "./lsp";

// [name, content, label (default: the name)]
export function Tabs({ tabs, initial }: { tabs: [string, ReactNode, ReactNode?][]; initial?: string }) {
  const [current, setCurrent] = useState(initial ?? tabs[0][0]);
  return (
    <div className="tabs">
      <nav>
        {tabs.map(([name, , label]) => (
          <button key={name} className={name === current ? "on" : ""} onClick={() => setCurrent(name)}>
            {label ?? name}
          </button>
        ))}
      </nav>
      {tabs.map(([name, content]) => (
        <div key={name} className="tab" hidden={name !== current}>
          {content}
        </div>
      ))}
    </div>
  );
}

// Files

type FilesProps = {
  files: string[];
  active: string;
  open: (name: string) => void;
  create: (name: string, text?: string) => void;
  rename: (from: string, to: string) => void;
  remove: (name: string) => void;
  // files read from a folder on disk
  opened: (names: string[]) => void;
  // the workspace as a zip archive, and one read into it
  exportZip: () => void;
  importZip: (file: File) => void;
  // the files Rocq wrote: [path, size], shown and downloaded
  produced: [string, number][];
  view: (path: string) => void;
  download: (path: string) => void;
};

// The directories of a path, then its name: "A/B/C.v" -> ["A", "B"], "C.v"
const split = (path: string): [string[], string] => {
  const parts = path.split("/");
  return [parts.slice(0, -1), parts[parts.length - 1]];
};

// Files sorted by directory: those of a directory after its subdirectories'
const byDirectory = (a: string, b: string) => {
  const [da, na] = split(a);
  const [db, nb] = split(b);
  for (let i = 0; i < Math.min(da.length, db.length); i++) if (da[i] !== db[i]) return da[i] < db[i] ? -1 : 1;
  if (da.length !== db.length) return db.length - da.length;
  return na < nb ? -1 : na > nb ? 1 : 0;
};

export function Files(props: FilesProps) {
  const { files, active, open, create, rename, remove, opened } = props;
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name === projectFile || name.endsWith(".v") ? name : name + ".v";
    if (!validName(n)) return setError("Use letters, digits, _ and ' (Rocq module names), and / between folders");
    if (n !== editing && files.includes(n)) return setError(`${n} already exists`);
    if (editing === "") create(n, n === projectFile ? "-R . Workspace\n" : "");
    else if (editing && n !== editing) rename(editing, n);
    setEditing(null);
    setError("");
  };
  const upload = async (list: FileList | null) => {
    for (const f of Array.from(list ?? []))
      // (a zip archive: by its signature, PK)
      if (new TextDecoder().decode(await f.slice(0, 2).arrayBuffer()) === "PK") props.importZip(f);
      else if (validName(f.name)) create(f.name, await f.text());
  };
  const form = (
    <form onSubmit={submit} className="file-form">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setEditing(null)} />
      {error && <div className="error">{error}</div>}
    </form>
  );
  // (a directory's name before its first file)
  let shownDirs: string[] = [];
  const rows = [...files].sort(byDirectory).flatMap((f) => {
    const [dirs, base] = split(f);
    const out = [];
    let i = 0;
    while (i < dirs.length && shownDirs[i] === dirs[i]) i++;
    for (; i < dirs.length; i++)
      out.push(
        <li key={`dir:${dirs.slice(0, i + 1).join("/")}`} className="dir" style={{ paddingLeft: `${i}rem` }}>
          {dirs[i]}/
        </li>,
      );
    shownDirs = dirs;
    out.push(
      editing === f ? (
        <li key={f}>{form}</li>
      ) : (
        <li key={f} className={f === active ? "on" : ""} style={{ paddingLeft: `${dirs.length}rem` }}>
          <button className="name" title={f} onClick={() => open(f)} onDoubleClick={() => (setEditing(f), setName(f))}>
            {base}
            {isOnDisk(f) && (
              <span className="disk" title="saved to its folder on disk">
                {" "}
                ⇄
              </span>
            )}
          </button>
          <button title="Rename or move" onClick={() => (setEditing(f), setName(f))}>
            ✎
          </button>
          <button
            title="Delete"
            disabled={files.filter(isRocq).length === 1 && isRocq(f)}
            onClick={() => confirm(`Delete ${f}?`) && remove(f)}
          >
            ×
          </button>
        </li>
      ),
    );
    return out;
  });
  return (
    <div className="files">
      <ul>
        {rows}
        {editing === "" && <li>{form}</li>}
      </ul>
      <div className="actions">
        <button onClick={() => (setEditing(""), setName(""))} title="A file, in a folder with a path (Sub/Name)">
          New file
        </button>
        <label className="button" title=".v files, or a zip archive of a workspace">
          Open…
          <input type="file" accept=".v,.zip" multiple hidden onChange={(e) => upload(e.target.files)} />
        </label>
        {canOpenFolder() && (
          <button title="The .v files of a folder and its subfolders, saved back to it" onClick={() => openFolder().then(opened, () => {})}>
            Open folder…
          </button>
        )}
        <button title="All the files in a zip archive" onClick={props.exportZip}>
          Export zip
        </button>
        {!files.includes(projectFile) && (
          <button title="Rocq's options for the workspace: its load path (-R, -Q), -arg" onClick={() => create(projectFile, "-R . Workspace\n")}>
            New _RocqProject
          </button>
        )}
      </div>
      <p className="muted">
        {files.includes(projectFile) ? (
          <>
            <code>_RocqProject</code> names the modules of the files. Another file loads one with <code>Require Import</code>,
            which compiles it first.
          </>
        ) : (
          <>
            Each file is the module <code>Workspace.NAME</code> (<code>Workspace.DIR.NAME</code> in a folder). Another file
            loads it with <code>Require Import NAME.</code>, which compiles it first.
          </>
        )}
      </p>
      {props.produced.length > 0 && (
        <>
          <h3>Written by Rocq</h3>
          <ul className="produced">
            {props.produced.map(([p, size]) => (
              <li key={p}>
                <button className="name" onClick={() => props.view(p)} title="Show it">
                  {p}
                </button>
                <span className="muted">{size < 1e4 ? `${size} B` : `${Math.round(size / 1e3)} kB`}</span>
                <button title="Download" onClick={() => props.download(p)}>
                  ↓
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// Outline: coq-lsp's document symbols

const kinds: Record<number, string> = { 2: "module", 5: "class", 6: "method", 12: "function", 13: "variable", 23: "struct" };

function flatten(symbols: DocumentSymbol[], depth = 0): [DocumentSymbol, number][] {
  return symbols.flatMap((s) => [[s, depth] as [DocumentSymbol, number], ...flatten(s.children ?? [], depth + 1)]);
}

export function Outline({ symbols, goTo }: { symbols: DocumentSymbol[]; goTo: (r: Range) => void }) {
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

export function Packages({ packages, insert }: { packages: Package[] | null; insert: (line: string) => void }) {
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

// Problems: the diagnostics of the file

const severityNames = ["", "error", "warning", "info", "hint"];

// (depError: a file the file requires does not compile)
export function Problems({ diagnostics, goTo, depError }: { diagnostics: Diagnostic[]; goTo: (r: Range) => void; depError?: string | null }) {
  const shown = diagnostics.filter((d) => d.severity <= 2);
  if (shown.length === 0 && !depError) return <p className="muted">No errors or warnings.</p>;
  return (
    <ul className="problems">
      {depError && (
        <li className="dep-error">
          <span className="sev sev-1">error</span> {depError}
        </li>
      )}
      {shown.map((d, i) => (
        <li key={i}>
          <button onClick={() => goTo(d.range)}>
            <span className={`sev sev-${d.severity}`}>{severityNames[d.severity]}</span> line {d.range.start.line + 1}:{" "}
            {d.message}
          </button>
        </li>
      ))}
    </ul>
  );
}

// Queries: a command run at the cursor, the document unchanged

export type QueryResult = { command: string; messages: string[]; error?: string };
const commands = ["Search", "About", "Check", "Print", "Locate", "Compute"];

export function Query({ results, run }: { results: QueryResult[]; run: (command: string) => void }) {
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    run(/\.\s*$/.test(t) ? t : t + ".");
  };
  return (
    <div className="query">
      <form onSubmit={submit}>
        <input
          placeholder="Search _ + _ = _ + _. (at the cursor)"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </form>
      <div className="presets">
        {commands.map((c) => (
          <button key={c} onClick={() => setText(`${c} ${text.replace(/^\s*\w+\s+/, "")}`)}>
            {c}
          </button>
        ))}
      </div>
      {results.map((r, i) => (
        <div className="result" key={i}>
          <div className="command">{r.command}</div>
          {r.error && <pre className="error">{r.error}</pre>}
          {r.messages.map((m, j) => (
            <pre className="message" key={j}>
              {m}
            </pre>
          ))}
          {!r.error && r.messages.length === 0 && <p className="muted">No output.</p>}
        </div>
      ))}
    </div>
  );
}

// Search of the libraries' sources: their declarations (search.tsv, from
// scripts/search-index.mjs), downloaded on the first search

type Declaration = { module: string; path: string; kind: string; name: string; line: number; statement: string };

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

export function LibrarySearch({ url, open }: { url: string; open: (d: Declaration) => void }) {
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
