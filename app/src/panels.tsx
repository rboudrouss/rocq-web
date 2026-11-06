// The panels around the editor: files, outline, packages (left), goals,
// problems, queries and the log (right).
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { canOpenFolder, isOnDisk, openFolder, validName } from "./files";
import type { Diagnostic, DocumentSymbol, Goal, GoalsResult, Range } from "./lsp";

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
};

export function Files({ files, active, open, create, rename, remove, opened }: FilesProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.endsWith(".v") ? name : name + ".v";
    if (!validName(n)) return setError("Use letters, digits, _ and ' (a Rocq module name)");
    if (n !== editing && files.includes(n)) return setError(`${n} already exists`);
    if (editing === "") create(n);
    else if (editing && n !== editing) rename(editing, n);
    setEditing(null);
    setError("");
  };
  const upload = async (list: FileList | null) => {
    for (const f of Array.from(list ?? [])) if (validName(f.name)) create(f.name, await f.text());
  };
  const form = (
    <form onSubmit={submit} className="file-form">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setEditing(null)} />
      {error && <div className="error">{error}</div>}
    </form>
  );
  return (
    <div className="files">
      <ul>
        {files.map((f) =>
          editing === f ? (
            <li key={f}>{form}</li>
          ) : (
            <li key={f} className={f === active ? "on" : ""}>
              <button className="name" onClick={() => open(f)} onDoubleClick={() => (setEditing(f), setName(f))}>
                {f}
                {isOnDisk(f) && (
                  <span className="disk" title="saved to its folder on disk">
                    {" "}
                    ⇄
                  </span>
                )}
              </button>
              <button title="Rename" onClick={() => (setEditing(f), setName(f))}>
                ✎
              </button>
              <button
                title="Delete"
                disabled={files.length === 1}
                onClick={() => confirm(`Delete ${f}?`) && remove(f)}
              >
                ×
              </button>
            </li>
          ),
        )}
        {editing === "" && <li>{form}</li>}
      </ul>
      <div className="actions">
        <button onClick={() => (setEditing(""), setName(""))}>New file</button>
        <label className="button">
          Open…
          <input type="file" accept=".v" multiple hidden onChange={(e) => upload(e.target.files)} />
        </label>
        {canOpenFolder() && (
          <button title="The .v files of a folder, saved back to it" onClick={() => openFolder().then(opened, () => {})}>
            Open folder…
          </button>
        )}
      </div>
      <p className="muted">
        Each file is the module <code>Workspace.NAME</code>. Another file loads it with <code>Require Import NAME.</code>,
        which compiles it first.
      </p>
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

// Goals

function GoalView({ goal, index }: { goal: Goal; index: number }) {
  return (
    <div className="goal">
      {index === 0 &&
        goal.hyps.map((h, i) => (
          <div className="hyp" key={i}>
            <b>{h.names.join(", ")}</b>
            {h.def != null && <> := {h.def}</>} : {h.ty}
          </div>
        ))}
      <div className="bar">{index === 0 ? "" : `goal ${index + 1}`}</div>
      <div className="concl">{goal.ty}</div>
    </div>
  );
}

export function Goals({ result }: { result: GoalsResult | null }) {
  if (!result) return <p className="muted">Move the cursor into a proof.</p>;
  const g = result.goals;
  const messages = result.messages.map((m) => (typeof m === "string" ? m : m.text));
  const pending = g ? g.stack.reduce((n, [l, r]) => n + l.length + r.length, 0) : 0;
  return (
    <>
      {g ? (
        g.goals.length > 0 ? (
          g.goals.map((goal, i) => <GoalView goal={goal} index={i} key={i} />)
        ) : (
          <p className="muted">No goals{pending > 0 && `, ${pending} unfocused`}.</p>
        )
      ) : (
        <p className="muted">Not in a proof.</p>
      )}
      {g && g.shelf.length > 0 && <p className="muted">{g.shelf.length} shelved</p>}
      {g && g.given_up.length > 0 && <p className="muted">{g.given_up.length} given up</p>}
      {result.error && <pre className="error">{result.error}</pre>}
      {messages.map((m, i) => (
        <pre className="message" key={i}>
          {m}
        </pre>
      ))}
    </>
  );
}

// Problems: the diagnostics of the file

const severityNames = ["", "error", "warning", "info", "hint"];

export function Problems({ diagnostics, goTo }: { diagnostics: Diagnostic[]; goTo: (r: Range) => void }) {
  const shown = diagnostics.filter((d) => d.severity <= 2);
  if (shown.length === 0) return <p className="muted">No errors or warnings.</p>;
  return (
    <ul className="problems">
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
