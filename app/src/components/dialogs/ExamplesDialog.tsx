// The examples and tutorials (public/examples), opened in a folder of the
// workspace
import type { Example } from "../../lib/examples";

export function ExamplesDialog({ list, open, close }: { list: Example[]; open: (e: Example) => void; close: () => void }) {
  return (
    <div className="modal" onClick={close}>
      <div className="examples" onClick={(e) => e.stopPropagation()}>
        <h2>Examples</h2>
        <p className="muted">
          An example's files are copied into a workspace of their own, a folder of your files. A link with{" "}
          <code>?example=Basics</code> opens one directly, and <code>?embed</code> shows it in another page (an iframe).
        </p>
        <ul>
          {list.map((e) => (
            <li key={e.id}>
              <button onClick={() => open(e)}>
                <b>{e.title}</b> <span className="muted">{e.files.join(", ")}</span>
                <div>{e.description}</div>
              </button>
            </li>
          ))}
        </ul>
        <button onClick={close}>Close</button>
      </div>
    </div>
  );
}
