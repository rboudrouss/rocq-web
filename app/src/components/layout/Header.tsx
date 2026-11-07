// The page's header: Rocq's status (and the files it downloads), the file
// open, when Rocq checks it, the actions on the page
import { CircleHelp } from "lucide-react";

type Props = {
  status: string;
  fetching: { path: string; files: number; bytes: number } | null;
  file: string;
  toCursor: boolean;
  changeMode: (toCursor: boolean) => void;
  embedded: boolean;
  build: string;
  restart: () => void;
  examples: () => void;
  share: () => void;
  download: () => void;
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
        value={p.toCursor ? "cursor" : "all"}
        onChange={(e) => p.changeMode(e.target.value === "cursor")}
        title="When Rocq checks the file (up to the cursor: Alt+Enter)"
      >
        <option value="all">Check as you type</option>
        <option value="cursor">Check up to the cursor</option>
      </select>
      {p.embedded ? (
        <button onClick={p.openFull} title="This file in rocq-web, in a new tab">
          Open in rocq-web ↗
        </button>
      ) : (
        <>
          <button onClick={p.restart} title="Start Rocq again (a computation that does not stop)">
            Restart
          </button>
          <button onClick={p.examples} title="Examples and tutorials">
            Examples
          </button>
          <button onClick={p.share} title="Copy a link to this file">
            Share
          </button>
          <button onClick={p.download} title="Download the file">
            Download
          </button>
        </>
      )}
      <button className="help-button" onClick={p.help} title="Keyboard shortcuts" aria-label="Keyboard shortcuts">
        <CircleHelp size={15} />
      </button>
      {!p.embedded && <span className="muted">build: {p.build}</span>}
    </header>
  );
}
