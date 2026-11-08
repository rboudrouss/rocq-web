// The user's files (lib/storage.ts) as React state: the files, folders
// and workspaces, the file open in the editor, the texts being edited
// (saved after a pause), and the operations of the files' panel. Each
// change of a file is reported to a mirror (the worker's copy of the
// files: hooks/useRocqSession.ts).
import { useCallback, useMemo, useRef, useState } from "react";
import { type DiskFile, forgetOnDisk, movedOnDisk, placed as placedPath, saveToDisk } from "../lib/disk";
import {
  activeFile,
  dirname,
  isRocq,
  listFiles,
  listFolders,
  listWorkspaces,
  readFile,
  removeFile,
  setActiveFile,
  setFolders,
  setWorkspaces,
  validFolder,
  validName,
  within,
  writeFile,
} from "../lib/storage";
import { canBeWorkspace, generatedProject, root } from "../lib/workspaces";

export type Mirror = {
  // a file written (null: removed)
  write: (path: string, text: string | null) => void;
  // the workspaces changed (added, removed, renamed)
  workspacesChanged: () => void;
};

// A path moved from [from] to [to] (a folder: what is under it too)
const moved = (path: string, from: string, to: string) =>
  path === from ? to : path.startsWith(from + "/") ? to + path.slice(from.length) : path;


export function useWorkspace(log: (message: string) => void) {
  const [files, setFiles] = useState(listFiles);
  const [folders, setFolderList] = useState(listFolders);
  const [workspaces, setWorkspaceList] = useState(listWorkspaces);
  const [active, setActive] = useState(() => activeFile(files));
  // (for the callbacks of the worker and of Rocq)
  const state = useRef({ files, folders, workspaces, active });
  state.current = { files, folders, workspaces, active };
  const texts = useRef(new Map<string, string>());
  const mirror = useRef<Mirror | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  const read = useCallback((name: string) => texts.current.get(name) ?? readFile(name), []);

  // The texts being edited, saved (to the browser, to their file on disk,
  // to the worker)
  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    for (const [name, text] of texts.current) {
      writeFile(name, text);
      saveToDisk(name, text).catch((e: Error) => log(`${name} was not saved to disk (${e.message})`));
      mirror.current?.write(name, text);
    }
    texts.current.clear();
  }, [log]);

  const edit = useCallback(
    (name: string, text: string) => {
      texts.current.set(name, text);
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(flush, 500);
    },
    [flush],
  );

  const refresh = useCallback(() => {
    const fs = listFiles();
    setFiles(fs);
    setFolderList(listFolders());
    setWorkspaceList(listWorkspaces());
    state.current.files = fs;
    state.current.workspaces = listWorkspaces();
    return fs;
  }, []);

  const select = useCallback(
    (name: string) => {
      if (name === state.current.active) return;
      flush();
      state.current.active = name;
      setActive(name);
      setActiveFile(name);
    },
    [flush],
  );

  const write = (name: string, text: string) => {
    writeFile(name, text);
    mirror.current?.write(name, text);
  };

  const createFile = useCallback(
    (path: string, text = "") => {
      write(path, text);
      refresh();
      select(path);
    },
    [refresh, select],
  );

  const createFolder = useCallback(
    (path: string) => {
      setFolders([...listFolders(), path]);
      refresh();
    },
    [refresh],
  );

  // A file or a folder renamed or moved (a file of the same path replaced)
  const move = useCallback(
    (from: string, to: string) => {
      if (from === to || within(to, from)) return;
      flush();
      const ws = state.current.workspaces;
      for (const f of listFiles())
        if (within(f, from) && from !== root) {
          const t = moved(f, from, to);
          write(t, readFile(f));
          removeFile(f);
          mirror.current?.write(f, null);
          movedOnDisk(f, t);
        }
      setFolders(listFolders().map((d) => moved(d, from, to)));
      const nextWs = ws.map((w) => moved(w, from, to));
      const wsChanged = nextWs.some((w, i) => w !== ws[i]);
      setWorkspaces(nextWs);
      const fs = refresh();
      const a = moved(state.current.active, from, to);
      if (a !== state.current.active) {
        state.current.active = a;
        setActive(a);
        setActiveFile(a);
      }
      if (wsChanged) mirror.current?.workspacesChanged();
      if (!fs.includes(state.current.active)) select(fs.find(isRocq) ?? fs[0]);
    },
    [flush, refresh, select],
  );

  // A file, or a folder and what is in it
  const remove = useCallback(
    (path: string) => {
      for (const f of listFiles())
        if (within(f, path)) {
          texts.current.delete(f);
          removeFile(f);
          forgetOnDisk(f);
          mirror.current?.write(f, null);
        }
      setFolders(listFolders().filter((d) => !within(d, path)));
      const ws = listWorkspaces();
      const rest = ws.filter((w) => !within(w, path));
      setWorkspaces(rest);
      const fs = refresh();
      if (rest.length !== ws.length) mirror.current?.workspacesChanged();
      if (!fs.includes(state.current.active)) {
        const next = fs.find(isRocq) ?? fs[0];
        state.current.active = next;
        setActive(next);
        setActiveFile(next);
      }
    },
    [refresh],
  );

  const toggleWorkspace = useCallback(
    (folder: string) => {
      const ws = listWorkspaces();
      if (ws.includes(folder)) setWorkspaces(ws.filter((w) => w !== folder));
      else if (canBeWorkspace(folder, ws)) setWorkspaces([...ws, folder]);
      else return log(`${folder} cannot be a workspace, workspaces do not contain one another`);
      refresh();
      mirror.current?.workspacesChanged();
    },
    [log, refresh],
  );

  // Files from disk, under the folder [into] (the root: ""): each folder
  // imported at the root becomes a workspace. Files that differ from those
  // of the same path replace them once confirmed. The paths written.
  const importFiles = useCallback(
    (found: DiskFile[], into: string, options: { workspaces?: boolean } = {}) => {
      const placed = found
        .map(({ path, text }) => ({ path: placedPath(path, into), text }))
        .filter(({ path }) => validName(path));
      if (placed.length === 0) {
        log("nothing to import, no Rocq files (.v) nor project files");
        return [];
      }
      const mine = new Set(listFiles());
      const replaced = placed.filter(({ path, text }) => mine.has(path) && read(path) !== text).map(({ path }) => path);
      if (replaced.length && !confirm(`Replace ${replaced.length} files (${replaced.slice(0, 5).join(", ")})?`)) return [];
      flush();
      for (const { path, text } of placed) write(path, text);
      if (options.workspaces ?? into === root) {
        const ws = listWorkspaces();
        const tops = [...new Set(placed.filter(({ path }) => path.includes("/")).map(({ path }) => path.split("/")[0]))];
        const added = tops.filter((t) => validFolder(t) && canBeWorkspace(t, ws));
        if (added.length) setWorkspaces([...ws, ...added]);
      }
      refresh();
      mirror.current?.workspacesChanged();
      log(`imported ${placed.length} files${into ? ` into ${into}` : ""}`);
      const first = placed.find(({ path }) => isRocq(path));
      if (first) select(first.path);
      return placed.map(({ path }) => path);
    },
    [flush, log, read, refresh, select],
  );

  // A workspace's project file, written from the generated one to change it
  const customizeProject = useCallback(
    (dir: string) => {
      const path = dir ? `${dir}/_RocqProject` : "_RocqProject";
      const files = listFiles();
      if (!files.includes(path)) write(path, generatedProject(dir, files, listWorkspaces(), read));
      refresh();
      select(path);
    },
    [read, refresh, select],
  );

  // All the folders: those of the files, and the empty ones
  const allFolders = useMemo(() => {
    const out = new Set(folders);
    for (const f of files) for (let d = dirname(f); d; d = dirname(d)) out.add(d);
    for (const w of workspaces) out.add(w);
    return [...out].sort();
  }, [files, folders, workspaces]);

  return {
    files,
    folders: allFolders,
    workspaces,
    active,
    read,
    edit,
    flush,
    select,
    refresh,
    createFile,
    createFolder,
    move,
    remove,
    toggleWorkspace,
    importFiles,
    customizeProject,
    // (current, for callbacks outside of React's renders)
    current: state,
    setMirror: (m: Mirror | null) => (mirror.current = m),
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
