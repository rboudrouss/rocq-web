// A file shown read only instead of the editor: a library's source, a file
// Rocq wrote
import type { ReadOnlyFile } from "../../hooks/useNavigation";
import { Editor } from "./Editor";

export function ReadOnlyView({ file, back, backTo }: { file: ReadOnlyFile; back: () => void; backTo: string }) {
  return (
    <div className="editor-wrap library">
      <div className="library-bar">
        <span>
          {file.path} <span className="muted">({file.note ?? "library, read only"})</span>
        </span>
        <button onClick={back}>Back to {backTo}</button>
      </div>
      <Editor key={file.uri} initial={file.text} at={file.range} readOnly />
    </div>
  );
}
