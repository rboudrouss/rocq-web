// The page's header: Rocq's status (and the files it downloads), the file
// open, when Rocq checks it (step by step: RocqIDE's buttons), the actions
// on the page
import { ArrowDown, ArrowDownToLine, ArrowRightToLine, ArrowUp, ArrowUpToLine, CircleHelp } from "lucide-react";
import type { Move } from "../../hooks/useDocument";
import { navLabel } from "../../lib/keys";

const moves: [Move, string, typeof ArrowDown, string][] = [
  ["start", "Back to the start", ArrowUpToLine, "Home"],
  ["previous", "Back one sentence", ArrowUp, "ArrowUp"],
  ["next", "Check the next sentence", ArrowDown, "ArrowDown"],
  ["cursor", "Check up to the cursor", ArrowRightToLine, "ArrowRight"],
  ["end", "Check up to the end", ArrowDownToLine, "End"],
];

type Props = {
  status: string;
  fetching: { path: string; files: number; bytes: number } | null;
  file: string;
  stepByStep: boolean;
  changeMode: (stepByStep: boolean) => void;
  move: (where: Move) => void;
  embedded: boolean;
  restart: () => void;
  share: () => void;
  openFull: () => void;
  help: () => void;
};

export function Header(p: Props) {
  return (
    <header>
      <h1>rocq-web</h1>
      <span className="status" data-status={p.status}>
        {p.status}
      </span>
      {p.fetching && (
        <span className="fetching" title={p.fetching.path}>
          downloading {p.fetching.path.replace(/^\/coqlib\/(user-contrib|theories)\//, "").replace(/^\/plugins\//, "plugin ")} (
          {p.fetching.files} files, {(p.fetching.bytes / 1e6).toFixed(1)} MB)
        </span>
      )}
      <span className="file">{p.file}</span>
      <select
        value={p.stepByStep ? "step" : "all"}
        onChange={(e) => p.changeMode(e.target.value === "step")}
        title="When Rocq checks the file: step by step as in RocqIDE, the goals where the checking is; or all of it as you type, the goals at the cursor"
      >
        <option value="step">Step by step</option>
        <option value="all">Check as you type</option>
      </select>
      {p.stepByStep && (
        <span className="nav" role="toolbar" aria-label="Navigation">
          {moves.map(([where, what, Icon, key]) => (
            <button
              key={where}
              data-move={where}
              // (the editor keeps the focus)
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => p.move(where)}
              title={`${what} (${navLabel(key)})`}
              aria-label={what}
            >
              <Icon size={15} />
            </button>
          ))}
        </span>
      )}
      {p.embedded ? (
        <button onClick={p.openFull} title="This file in rocq-web, in a new tab">
          Open in rocq-web ↗
        </button>
      ) : (
        <>
          <button onClick={p.restart} title="Start Rocq again (a computation that does not stop)">
            Restart
          </button>
          <button onClick={p.share} title="Copy a link to this file">
            Share
          </button>
        </>
      )}
      <button className="help-button" onClick={p.help} title="Keyboard shortcuts" aria-label="Keyboard shortcuts">
        <CircleHelp size={15} />
      </button>
    </header>
  );
}
