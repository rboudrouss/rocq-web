// The examples and tutorials (public/examples), copied into a folder of
// the workspace
import { useEffect, useState } from "react";
import { type Example, examples } from "../../lib/examples";

export function ExamplesPanel({ open, log }: { open: (e: Example) => void; log: (m: string) => void }) {
  const [list, setList] = useState<Example[] | null>(null);
  useEffect(() => {
    examples().then(setList, (e: Error) => (log(`examples: ${e.message}`), setList([])));
  }, [log]);
  return (
    <div className="examples">
      {list === null && <p className="muted">Loading…</p>}
      <ul>
        {list?.map((e) => (
          <li key={e.id}>
            <button onClick={() => open(e)} title={e.files.join(", ")}>
              <b>{e.title}</b>
              <div>{e.description}</div>
            </button>
          </li>
        ))}
      </ul>
      <p className="muted">
        An example's files are copied into a workspace of their own, a folder of your files. A link with{" "}
        <code>?example=Basics</code> opens one directly, and <code>?embed</code> shows it in another page (an iframe).
      </p>
    </div>
  );
}
