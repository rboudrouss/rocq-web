// The rows of the files' tree: folders (folded by a click, workspaces
// marked), files (opened by a click), each dragged onto a folder to move
// it, with a menu on a right click; and the row where a name is typed (a
// new file or folder, a rename)
import { ChevronDown, ChevronRight, FileCode2, FileCog, Folder, FolderOpen, Layers } from "lucide-react";
import { type DragEvent, type FormEvent, type MouseEvent, useState } from "react";
import { isOnDisk } from "../../lib/disk";
import { isProject } from "../../lib/storage";
import type { TreeNode } from "./tree";

export type Editing = { kind: "file" | "folder"; parent: string; from?: string } | null;

export type TreeProps = {
  nodes: TreeNode[];
  active: string;
  collapsed: Set<string>;
  workspaces: string[];
  // workspace folder -> its project file is the user's
  custom: (folder: string) => boolean;
  logical: (folder: string) => string;
  dragOver: string | null;
  editing: Editing;
  open: (path: string) => void;
  toggle: (folder: string) => void;
  menu: (e: MouseEvent, node: TreeNode) => void;
  drag: (e: DragEvent, node: TreeNode) => void;
  over: (e: DragEvent, folder: string) => void;
  drop: (e: DragEvent, folder: string) => void;
  submit: (name: string) => string | null;
  cancel: () => void;
};

export function NameRow({ depth, initial, placeholder, submit, cancel }: {
  depth: number;
  initial: string;
  placeholder?: string;
  submit: TreeProps["submit"];
  cancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const done = (e: FormEvent) => {
    e.preventDefault();
    const err = submit(name.trim());
    if (err) setError(err);
  };
  return (
    <li className="editing" style={{ paddingLeft: `${depth * 0.9 + 0.3}rem` }}>
      <form onSubmit={done} className="file-form">
        <input
          autoFocus
          value={name}
          placeholder={placeholder}
          onChange={(e) => (setName(e.target.value), setError(null))}
          onBlur={cancel}
          onKeyDown={(e) => e.key === "Escape" && cancel()}
          onFocus={(e) => {
            // (the name without its extension selected)
            const dot = e.target.value.lastIndexOf(".");
            e.target.setSelectionRange(e.target.value.lastIndexOf("/") + 1, dot > 0 ? dot : e.target.value.length);
          }}
        />
        {error && <div className="error">{error}</div>}
      </form>
    </li>
  );
}

export function FileTree(props: TreeProps & { depth?: number; parent?: string }) {
  const { nodes, depth = 0, parent = "", editing } = props;
  const pad = (d: number) => ({ paddingLeft: `${d * 0.9 + 0.3}rem` });
  const creatingHere = editing && !editing.from && editing.parent === parent;
  return (
    <>
      {creatingHere && <NameRow depth={depth} initial="" placeholder={editing.kind === "file" ? "Name.v" : "Folder"} submit={props.submit} cancel={props.cancel} />}
      {nodes.map((n) => {
        if (editing?.from === n.path)
          return <NameRow key={n.path} depth={depth} initial={n.path} submit={props.submit} cancel={props.cancel} />;
        if (n.kind === "file")
          return (
            <li
              key={n.path}
              className={n.path === props.active ? "on" : ""}
              draggable
              onDragStart={(e) => props.drag(e, n)}
              onDragOver={(e) => props.over(e, parent)}
              onDrop={(e) => props.drop(e, parent)}
              onContextMenu={(e) => props.menu(e, n)}
            >
              <button className="name" title={n.path} style={pad(depth)} onClick={() => props.open(n.path)}>
                <span className="row-icon">{isProject(n.path) ? <FileCog size={14} /> : <FileCode2 size={14} />}</span>
                {n.name}
                {isOnDisk(n.path) && (
                  <span className="disk" title="saved to its folder on disk">
                    {" "}
                    ⇄
                  </span>
                )}
              </button>
            </li>
          );
        const folded = props.collapsed.has(n.path);
        const ws = props.workspaces.includes(n.path);
        return (
          <li key={n.path} className="folder">
            <ul>
              <li
                className={`dir${props.dragOver === n.path ? " drop" : ""}${ws ? " workspace" : ""}`}
                draggable
                onDragStart={(e) => props.drag(e, n)}
                onDragOver={(e) => props.over(e, n.path)}
                onDrop={(e) => props.drop(e, n.path)}
                onContextMenu={(e) => props.menu(e, n)}
                onClick={() => props.toggle(n.path)}
                style={pad(depth)}
                title={ws ? `Workspace: its files are the modules ${props.logical(n.path)}.*` : n.path}
              >
                <span className="row-icon chevron">{folded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</span>
                <span className="row-icon">{ws ? <Layers size={14} /> : folded ? <Folder size={14} /> : <FolderOpen size={14} />}</span>
                {n.name}/
                {ws && (
                  <span className="ws-chip" title={props.custom(n.path) ? "Its own project file" : "Its project file is generated"}>
                    {props.logical(n.path)}
                    {props.custom(n.path) ? " · custom" : ""}
                  </span>
                )}
              </li>
              {!folded && <FileTree {...props} nodes={n.children} depth={depth + 1} parent={n.path} />}
            </ul>
          </li>
        );
      })}
    </>
  );
}
