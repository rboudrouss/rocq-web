// The files' panel: the tree of the files and folders, its toolbar (new
// file or folder, a folder imported from disk, the workspace as a zip
// archive), a menu on each row (workspaces, project files, rename,
// download, delete), files and folders dragged onto a folder (moved) or
// dropped from disk (imported), and the files Rocq wrote.
import {
  Archive,
  ChevronsDownUp,
  Download,
  FileCog,
  FilePlus,
  FolderInput,
  FolderPlus,
  FolderSync,
  Layers,
  Pencil,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { type DragEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { saveBlob, saveZip } from "../../lib/download";
import { canOpenFolder, openFolder, readDropped, readInput } from "../../lib/disk";
import { basename, dirname, isProject, isRocq, projectFile, validFolder, validName, within } from "../../lib/storage";
import { canBeWorkspace, customProject, generatedProject, root, workspaceName, workspaceOf } from "../../lib/workspaces";
import type { Workspace } from "../../hooks/useWorkspace";
import { usePersistentState } from "../../hooks/usePersistentState";
import { ContextMenu, type MenuItem } from "../ui/ContextMenu";
import { type Editing, FileTree } from "./FileTree";
import { buildTree, type TreeNode } from "./tree";
import "./files.css";

type Props = {
  ws: Workspace;
  // the files Rocq wrote: [path, size], shown and downloaded
  produced: [string, number][];
  viewProduced: (path: string) => void;
  downloadProduced: (path: string) => void;
  log: (m: string) => void;
};

const dragType = "application/x-rocq-web-path";

export function FilesPanel({ ws, produced, viewProduced, downloadProduced, log }: Props) {
  const [collapsedList, setCollapsed] = usePersistentState<string[]>("collapsed", []);
  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList]);
  const [editing, setEditing] = useState<Editing>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // the folder an import goes to
  const importInto = useRef(root);
  const tree = useMemo(() => buildTree(ws.files, ws.folders), [ws.files, ws.folders]);
  // (the modules of a workspace: NAME.*, as its project file says)
  const nameOf = (dir: string) => workspaceName(dir, ws.files, ws.read) ?? "?";

  useEffect(() => folderInput.current?.setAttribute("webkitdirectory", ""), []);

  const toggle = (folder: string) =>
    setCollapsed(collapsed.has(folder) ? collapsedList.filter((f) => f !== folder) : [...collapsedList, folder]);
  const expand = (folder: string) => setCollapsed(collapsedList.filter((f) => !within(folder, f)));

  const create = (kind: "file" | "folder", parent: string) => {
    if (parent) expand(parent);
    setEditing({ kind, parent });
  };

  // A name typed: an error, or null once done
  const submit = (typed: string): string | null => {
    if (!editing || !typed) return (setEditing(null), null);
    const { kind, parent, from } = editing;
    if (from !== undefined) {
      // (a rename: the whole path, to move it too)
      const to = typed.replace(/^\/+|\/+$/g, "");
      if (to === from) return (setEditing(null), null);
      const folder = !ws.files.includes(from);
      if (folder ? !validFolder(to) : !validName(to)) return nameError(folder);
      if (ws.files.includes(to) || ws.folders.includes(to)) return `${to} already exists`;
      ws.move(from, to);
    } else if (kind === "file") {
      const name = isProject(typed) || typed.endsWith(".v") ? typed : `${typed}.v`;
      const path = parent ? `${parent}/${name}` : name;
      if (!validName(path)) return nameError(false);
      if (ws.files.includes(path)) return `${path} already exists`;
      ws.createFile(path, isProject(path) ? generatedProject(dirname(path)) : "");
    } else {
      const path = parent ? `${parent}/${typed}` : typed;
      if (!validFolder(path)) return nameError(true);
      if (ws.folders.includes(path)) return `${path} already exists`;
      ws.createFolder(path);
    }
    setEditing(null);
    return null;
  };

  const zipOf = (folder: string) => {
    ws.flush();
    const files = ws.files.filter((f) => within(f, folder));
    const strip = folder ? dirname(folder).length + (dirname(folder) ? 1 : 0) : 0;
    saveZip(
      files.map((f) => [f.slice(strip), ws.read(f)]),
      folder ? `${basename(folder)}.zip` : "rocq-workspace.zip",
    );
  };

  const importFolder = (into: string) => {
    importInto.current = into;
    folderInput.current?.click();
  };
  const importFiles = (into: string) => {
    importInto.current = into;
    fileInput.current?.click();
  };
  const fromDisk = (into: string) =>
    openFolder(into).then(
      (found) => ws.importFiles(found, into),
      (e: Error) => e.name !== "AbortError" && log(`the folder could not be opened (${e.message})`),
    );

  const menuFor = (e: MouseEvent, node: TreeNode | null) => {
    e.preventDefault();
    e.stopPropagation();
    const folder = node === null ? root : node.kind === "folder" ? node.path : dirname(node.path);
    const items: MenuItem[] = [
      { label: "New file", icon: <FilePlus size={14} />, action: () => create("file", folder) },
      { label: "New folder", icon: <FolderPlus size={14} />, action: () => create("folder", folder) },
      { label: "Import folder…", icon: <FolderInput size={14} />, action: () => importFolder(folder) },
      { label: "Import files…", icon: <Upload size={14} />, action: () => importFiles(folder) },
    ];
    if (node?.kind === "folder") {
      const isWs = ws.workspaces.includes(node.path);
      const custom = customProject(node.path, ws.files);
      items.push("-");
      if (isWs || canBeWorkspace(node.path, ws.workspaces))
        items.push({
          label: isWs ? "Not a workspace" : "Make it a workspace",
          icon: <Layers size={14} />,
          action: () => ws.toggleWorkspace(node.path),
        });
      if (isWs)
        items.push(
          custom
            ? { label: `Open ${basename(custom)}`, icon: <FileCog size={14} />, action: () => ws.select(custom) }
            : { label: "Write its _RocqProject", icon: <FileCog size={14} />, action: () => ws.customizeProject(node.path) },
        );
      if (isWs && custom)
        items.push({
          label: "Use the generated project",
          icon: <RotateCcw size={14} />,
          action: () => confirm(`Delete ${custom}?`) && ws.remove(custom),
        });
      items.push(
        "-",
        { label: "Rename or move", icon: <Pencil size={14} />, action: () => setEditing({ kind: "folder", parent: dirname(node.path), from: node.path }) },
        { label: "Download as zip", icon: <Archive size={14} />, action: () => zipOf(node.path) },
        {
          label: "Delete",
          icon: <Trash2 size={14} />,
          danger: true,
          action: () => {
            const n = ws.files.filter((f) => within(f, node.path)).length;
            if (confirm(`Delete ${node.path}/${n ? ` and its ${n} files` : ""}?`)) ws.remove(node.path);
          },
        },
      );
    } else if (node?.kind === "file") {
      const lastRocq = isRocq(node.path) && ws.files.filter(isRocq).length === 1;
      items.push(
        "-",
        { label: "Rename or move", icon: <Pencil size={14} />, action: () => setEditing({ kind: "file", parent: dirname(node.path), from: node.path }) },
        {
          label: "Download",
          icon: <Download size={14} />,
          action: () => saveBlob(new Blob([ws.read(node.path)], { type: "text/plain" }), node.name),
        },
        {
          label: "Delete",
          icon: <Trash2 size={14} />,
          danger: true,
          disabled: lastRocq,
          action: () => confirm(`Delete ${node.path}?`) && ws.remove(node.path),
        },
      );
    } else {
      const custom = customProject(root, ws.files);
      items.push(
        "-",
        custom
          ? { label: `Open ${projectFile}`, icon: <FileCog size={14} />, action: () => ws.select(custom) }
          : { label: `Write the root's ${projectFile}`, icon: <FileCog size={14} />, action: () => ws.customizeProject(root) },
        { label: "Export all as zip", icon: <Archive size={14} />, action: () => zipOf(root) },
      );
    }
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  // Dragging: a row onto a folder moves it there; files and folders from
  // disk dropped are imported there
  const drag = (e: DragEvent, node: TreeNode) => {
    e.dataTransfer.setData(dragType, node.path);
    e.dataTransfer.effectAllowed = "move";
  };
  const over = (e: DragEvent, folder: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(dragType) ? "move" : "copy";
    setDragOver(folder);
  };
  const drop = async (e: DragEvent, folder: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null);
    const path = e.dataTransfer.getData(dragType);
    if (path) {
      const to = folder ? `${folder}/${basename(path)}` : basename(path);
      if (to === path || within(folder, path)) return;
      if (ws.files.includes(to) || ws.folders.includes(to)) return log(`${to} already exists`);
      if (folder) expand(folder);
      return ws.move(path, to);
    }
    const found = await readDropped(e.dataTransfer.items);
    if (found.length) ws.importFiles(found, folder);
    else log("nothing to import: no Rocq files (.v) nor project files");
  };

  const here = workspaceOf(ws.active, ws.workspaces);
  return (
    <div className="files" onContextMenu={(e) => menuFor(e, null)}>
      <div className="files-toolbar">
        <span className="title">Files</span>
        <button className="icon-button" title="New file" aria-label="New file" onClick={() => create("file", root)}>
          <FilePlus size={16} />
        </button>
        <button className="icon-button" title="New folder" aria-label="New folder" onClick={() => create("folder", root)}>
          <FolderPlus size={16} />
        </button>
        <button
          className="icon-button"
          title="Import a folder (a workspace of its own), or drop one here"
          aria-label="Import folder"
          onClick={() => importFolder(root)}
        >
          <FolderInput size={16} />
        </button>
        {canOpenFolder() && (
          <button
            className="icon-button"
            title="Open a folder on disk: its files saved back to it"
            aria-label="Open folder on disk"
            onClick={() => fromDisk(root)}
          >
            <FolderSync size={16} />
          </button>
        )}
        <button className="icon-button" title="Export zip: all the files" aria-label="Export zip" onClick={() => zipOf(root)}>
          <Archive size={16} />
        </button>
        <button className="icon-button" title="Fold all the folders" aria-label="Fold all" onClick={() => setCollapsed(ws.folders)}>
          <ChevronsDownUp size={16} />
        </button>
      </div>
      <div
        className={`files-tree${dragOver === root ? " drop" : ""}`}
        onDragOver={(e) => over(e, root)}
        onDragLeave={() => setDragOver(null)}
        onDrop={(e) => drop(e, root)}
      >
        <ul>
          <FileTree
            nodes={tree}
            active={ws.active}
            collapsed={collapsed}
            workspaces={ws.workspaces}
            custom={(f) => customProject(f, ws.files) !== null}
            logical={nameOf}
            dragOver={dragOver}
            editing={editing}
            open={ws.select}
            toggle={toggle}
            menu={menuFor}
            drag={drag}
            over={over}
            drop={drop}
            submit={submit}
            cancel={() => setEditing(null)}
          />
        </ul>
      </div>
      <p className="muted files-help">
        {here === root ? (
          customProject(root, ws.files) ? (
            <>
              <code>{projectFile}</code> names the modules of the files outside the workspaces.
            </>
          ) : (
            <>
              A file outside the workspaces is the module <code>Workspace.NAME</code> (<code>Workspace.DIR.NAME</code> in a
              folder).
            </>
          )
        ) : (
          <>
            {ws.active} is in the workspace <b>{here}</b>: its files are the modules{" "}
            <code>{nameOf(here)}.*</code>
            {customProject(here, ws.files) ? ", as its project file says" : ""}.
          </>
        )}{" "}
        <code>Require Import NAME.</code> compiles the file first. Right click for more.
      </p>
      {produced.length > 0 && (
        <>
          <h3>Written by Rocq</h3>
          <ul className="produced">
            {produced.map(([p, size]) => (
              <li key={p}>
                <button className="name" onClick={() => viewProduced(p)} title="Show it">
                  {p}
                </button>
                <span className="muted">{size < 1e4 ? `${size} B` : `${Math.round(size / 1e3)} kB`}</span>
                <button title="Download" onClick={() => downloadProduced(p)}>
                  ↓
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        onChange={async (e) => {
          const list = e.target.files;
          if (list) ws.importFiles(await readInput(list), importInto.current);
          e.target.value = "";
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept=".v,_RocqProject,_CoqProject"
        multiple
        hidden
        onChange={async (e) => {
          const list = e.target.files;
          if (list) {
            // (files, not a folder: none becomes a workspace)
            const found = await readInput(list);
            ws.importFiles(
              found.map((f) => ({ ...f, path: basename(f.path) })),
              importInto.current,
              { workspaces: false },
            );
          }
          e.target.value = "";
        }}
      />
      {menu && <ContextMenu {...menu} close={() => setMenu(null)} />}
    </div>
  );
}

const nameError = (folder: boolean) =>
  folder
    ? "Use letters, digits, _ ' - and . in folder names, / between folders"
    : "A file is a Rocq module name and .v (letters, digits, _ and '), or _RocqProject; / between folders";
