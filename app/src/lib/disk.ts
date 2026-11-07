// Files from the user's disk: a folder picked (an <input webkitdirectory>,
// or Chrome's File System Access API, whose files are then written back
// when they change), or files and folders dropped on the page. Only the
// Rocq files and project files are read, not those of hidden folders,
// _build or node_modules.
import { validName } from "./storage";

// A file read: its path from the folder picked or dropped, its name first
// ("Lib/theories/A.v")
export type DiskFile = { path: string; text: string };

const skipped = (folder: string) => folder.startsWith(".") || folder === "_build" || folder === "node_modules";
// (its folders' names may be anything: the file's path is checked once
// placed, by validName)
const wanted = (path: string) => {
  const parts = path.split("/");
  if (parts.slice(0, -1).some(skipped)) return false;
  return validName(parts[parts.length - 1]);
};

// Where a file from disk goes under the folder [into] of the workspace
// ("" its root): its folders' names made valid ones (validFolder's
// characters only)
export function placed(path: string, into: string) {
  const parts = path.split("/");
  const clean = (part: string) => part.replace(/[^A-Za-z0-9_'.-]/g, "_").replace(/^[.'-]/, "_");
  const name = [...parts.slice(0, -1).map(clean), parts[parts.length - 1]].join("/");
  return into ? `${into}/${name}` : name;
}

// The files of an <input type="file" webkitdirectory> (their
// webkitRelativePath: the folder's name first)
export async function readInput(list: FileList): Promise<DiskFile[]> {
  const out: DiskFile[] = [];
  for (const f of Array.from(list)) {
    const path = f.webkitRelativePath || f.name;
    if (wanted(path)) out.push({ path, text: await f.text() });
  }
  return out;
}

// The files and folders dropped (DataTransfer items, read as entries)
type Entry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (f: File) => void, fail: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (es: Entry[]) => void, fail: (e: unknown) => void) => void };
};

export async function readDropped(items: DataTransferItemList): Promise<DiskFile[]> {
  const entries = Array.from(items)
    .map((i) => (i as unknown as { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null)
    .filter((e): e is Entry => e !== null);
  const out: DiskFile[] = [];
  const walk = async (e: Entry, at: string): Promise<void> => {
    const path = at + e.name;
    if (e.isDirectory) {
      if (at && skipped(e.name)) return;
      const reader = e.createReader!();
      // (readEntries gives them in batches, until an empty one)
      for (;;) {
        const batch = await new Promise<Entry[]>((ok, fail) => reader.readEntries(ok, fail));
        if (batch.length === 0) break;
        for (const c of batch) await walk(c, path + "/");
      }
    } else if (wanted(path)) {
      const f = await new Promise<File>((ok, fail) => e.file!(ok, fail));
      out.push({ path, text: await f.text() });
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}

// Chrome's File System Access API: a folder whose files are written back
type DirectoryHandle = { kind: "directory"; name: string; values: () => AsyncIterable<DirectoryHandle | FileHandle> };
type FileHandle = {
  kind: "file";
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (t: string) => Promise<void>; close: () => Promise<void> }>;
};
// (by their path in the workspace, for this session)
const onDisk = new Map<string, FileHandle>();

export const canOpenFolder = () => "showDirectoryPicker" in window;
export const isOnDisk = (path: string) => onDisk.has(path);

// The files of a folder the user picks (its name first), to be placed under
// [into] (placed)
export async function openFolder(into: string): Promise<DiskFile[]> {
  const pick = (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirectoryHandle> }).showDirectoryPicker;
  const dir = await pick({ mode: "readwrite" });
  const out: DiskFile[] = [];
  const walk = async (d: DirectoryHandle, at: string) => {
    for await (const h of d.values()) {
      const path = at + h.name;
      if (h.kind === "directory") {
        if (!skipped(h.name)) await walk(h, path + "/");
      } else if (wanted(path)) {
        out.push({ path, text: await (await h.getFile()).text() });
        onDisk.set(placed(path, into), h);
      }
    }
  };
  await walk(dir, dir.name + "/");
  return out;
}

// A file moved in the workspace: its file on disk follows it
export function movedOnDisk(from: string, to: string) {
  const h = onDisk.get(from);
  if (!h) return;
  onDisk.delete(from);
  onDisk.set(to, h);
}
export const forgetOnDisk = (path: string) => onDisk.delete(path);

// Writes a file back to disk, if it came from there
export async function saveToDisk(path: string, text: string) {
  const h = onDisk.get(path);
  if (!h) return;
  const w = await h.createWritable();
  await w.write(text);
  await w.close();
}
