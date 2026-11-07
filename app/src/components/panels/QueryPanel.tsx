import { type FormEvent, useState } from "react";

// Queries: a command run at the cursor, the document unchanged

export type QueryResult = { command: string; messages: string[]; error?: string };
const commands = ["Search", "About", "Check", "Print", "Locate", "Compute"];

export function QueryPanel({ results, run }: { results: QueryResult[]; run: (command: string) => void }) {
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
