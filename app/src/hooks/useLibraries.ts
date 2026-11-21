// The libraries of Rocq files the user added (lib/library.ts), each a
// workspace of its own: added from the Packages panel (a GitHub repository,
// an archive's URL, an archive or a folder on disk), from the Files panel (archives
// imported) or from the page's URL (?lib=SPEC), listed with their modules and
// where they came from.
import { useCallback, useEffect, useRef, useState } from "react";
import { freeFolder, readInput } from "../lib/disk";
import { archiveLibrary, fetchLibrary, folderLibrary, gitHubRepository, type Library } from "../lib/library";
import { requires } from "../lib/project";
import { forgetLinkedLibraries, linkedLibraries } from "../lib/share";
import { isRocq, temporary } from "../lib/storage";
import { isLibraryName, moduleName, root } from "../lib/workspaces";
import type { Workspace } from "./useWorkspace";
import { usePersistentState } from "./usePersistentState";

// (folder: its workspace; source: a repository, a URL or a file's name;
// pinned: a repository's at the commit fetched, when it had no ref)
type Added = { folder: string; source: string; pinned?: string };
export type AddedLibrary = Added & { modules: string[] };

// Whether a library can be added again from its source (a link to it): a
// GitHub repository or a URL, not a file on disk
export const fetchable = (source: string) => gitHubRepository(source) !== null || /^https?:\/\//i.test(source);
// The source of a library in a link: the commit fetched if known
export const linkSource = (l: Added) => l.pinned ?? l.source;

export function useLibraries(ws: Workspace, log: (m: string) => void) {
  // (temporary: in memory, as its files are)
  const persisted = usePersistentState<Added[]>("libraries", []);
  const inMemory = useState<Added[]>([]);
  const [added, setAdded] = temporary ? inMemory : persisted;
  // (the latest list, for adds that end after another)
  const latest = useRef(added);
  latest.current = added;
  // what is being added, and the last error
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // (a library put in name_2...: the user's folder of its name holds other
  // files)
  const [notice, setNotice] = useState<string | null>(null);

  // (whether it was added)
  const add = useCallback(
    async (source: string, get: () => Promise<Library>): Promise<boolean> => {
      setError(null);
      setProgress(`fetching ${source}`);
      log(`fetching ${source}`);
      try {
        const lib = await get();
        if (!lib.files.some((f) => isRocq(f.path))) throw new Error(`${source} has no Rocq files (.v)`);
        // (a library's own folder: updated)
        const { files, folders, workspaces } = ws.current.current;
        const folder = latest.current.some((l) => l.folder === lib.name)
          ? lib.name
          : freeFolder(lib.name, lib.files, { files, folders: [...folders, ...workspaces] }, ws.read);
        if (folder !== lib.name) {
          const m = `The folder ${lib.name}/ already holds other files: the library ${source} is in ${folder}/, yours are unchanged`;
          setNotice(m);
          log(m);
        }
        const written = ws.importFiles(
          lib.files.map((f) => ({ path: `${folder}/${f.path}`, text: f.text })),
          root,
          { select: false },
        );
        if (!written.length) return false;
        setAdded([
          ...latest.current.filter((l) => l.folder !== folder),
          { folder, source, ...(lib.pinned && { pinned: lib.pinned }) },
        ]);
        const hidden = lib.names.filter(isLibraryName);
        if (hidden.length)
          log(`${lib.name} has modules ${hidden.join(", ")} as a library of the build does, Rocq may load either`);
        if (lib.plugins)
          log(`${lib.name} declares OCaml plugins (Declare ML Module), which cannot be built in the browser yet: only the build's packages have theirs`);
        log(`added the library ${folder}`);
        return true;
      } catch (e) {
        const err = e as Error;
        const message =
          err.name === "QuotaExceededError"
            ? `${source} is too large for the browser's storage of the files (a few MB)`
            : err.message;
        setError(message);
        log(message);
        return false;
      } finally {
        setProgress(null);
      }
    },
    [log, setAdded, ws],
  );

  // A GitHub repository (owner/repo[@ref], its URL) or an archive's URL
  const fromSpec = useCallback(
    (spec: string) =>
      add(spec, () =>
        fetchLibrary(spec, (done, total) => setProgress(`fetching ${spec}: ${done} of ${total} files`)),
      ),
    [add],
  );
  const fromArchive = useCallback(
    (file: File) => add(file.name, async () => archiveLibrary(file.name, new Uint8Array(await file.arrayBuffer()))),
    [add],
  );
  // (the files of an <input webkitdirectory>)
  const fromFolder = useCallback(
    (list: FileList) =>
      add(`${list[0]?.webkitRelativePath.split("/")[0] ?? "a folder"}/`, async () => folderLibrary(await readInput(list))),
    [add],
  );

  // (those still in the files, a library's folder deleted there too)
  const libraries: AddedLibrary[] = added
    .filter((l) => ws.workspaces.includes(l.folder))
    .map((l) => ({
      ...l,
      modules: ws.files
        .filter((f) => f.startsWith(`${l.folder}/`))
        .map((f) => moduleName(f, ws.workspaces, ws.files, ws.read))
        .filter((m): m is string => m !== null)
        .sort(),
    }));

  // The libraries of the page's URL, in turn, those not added already
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current) return;
    linked.current = true;
    (async () => {
      for (const spec of linkedLibraries) {
        const present = latest.current.some(
          (l) => (l.source === spec || l.pinned === spec) && ws.current.current.workspaces.includes(l.folder),
        );
        if (present) continue;
        if (!fetchable(spec)) log(`?lib=${spec} is neither a GitHub repository (owner/repo[@ref]) nor an archive's URL`);
        else await fromSpec(spec);
      }
      forgetLinkedLibraries();
    })();
  }, [fromSpec, log, ws]);

  // The sources of the libraries a file requires (those it requires in
  // turn too), those that can be added again: the libraries of its link
  const requiredBy = (file: string, text: string): string[] => {
    const { files, workspaces } = ws.current.current;
    const seen = new Set([file]);
    const todo = [[file, text] as const];
    const sources = new Set<string>();
    for (let next; (next = todo.pop()); )
      for (const dep of requires(next[0], next[1], files, workspaces, ws.read)) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        todo.push([dep, ws.read(dep)]);
        const lib = latest.current.find((l) => dep.startsWith(`${l.folder}/`));
        if (lib && fetchable(lib.source)) sources.add(linkSource(lib));
      }
    return [...sources];
  };

  const remove = (folder: string) => {
    if (!confirm(`Delete the library ${folder} and its files?`)) return;
    ws.remove(folder);
    setAdded(latest.current.filter((l) => l.folder !== folder));
  };

  return {
    libraries,
    progress,
    error,
    notice,
    dismissNotice: () => setNotice(null),
    fromSpec,
    fromArchive,
    fromFolder,
    remove,
    requiredBy,
  };
}

export type Libraries = ReturnType<typeof useLibraries>;
