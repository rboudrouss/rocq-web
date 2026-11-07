import type { Diagnostic, Range } from "../../lib/lsp";

// Problems: the diagnostics of the file

const severityNames = ["", "error", "warning", "info", "hint"];

// (depError: a file the file requires does not compile)
export function ProblemsPanel({ diagnostics, goTo, depError }: { diagnostics: Diagnostic[]; goTo: (r: Range) => void; depError?: string | null }) {
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
