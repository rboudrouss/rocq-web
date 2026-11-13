// The libraries of Rocq files the user added (lib/library.ts), each a
// workspace of its own: added from the Packages panel (a GitHub repository,
// an archive's URL or one on disk) or from the Files panel (archives
// imported), listed with their modules and where they came from.
import { useCallback, useRef, useState } from "react";
import { archiveLibrary, fetchLibrary, type Library } from "../lib/library";
import { isRocq } from "../lib/storage";
import { isLibraryName, moduleName, root } from "../lib/workspaces";
import type { Workspace } from "./useWorkspace";
import { usePersistentState } from "./usePersistentState";

// (folder: its workspace; source: a repository, a URL or a file's name)
type Added = { folder: string; source: string };
export type AddedLibrary = Added & { modules: string[] };

export function useLibraries(ws: Workspace, log: (m: string) => void) {
  const [added, setAdded] = usePersistentState<Added[]>("libraries", []);
  // (the latest list, for adds that end after another)
  const latest = useRef(added);
  latest.current = added;
  // what is being added, and the last error
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // (whether it was added)
  const add = useCallback(
    async (source: string, get: () => Promise<Library>): Promise<boolean> => {
      setError(null);
      setProgress(`fetching ${source}`);
      log(`fetching ${source}`);
      try {
        const lib = await get();
        if (!lib.files.some((f) => isRocq(f.path))) throw new Error(`${source} has no Rocq files (.v)`);
        const written = ws.importFiles(
          lib.files.map((f) => ({ path: `${lib.name}/${f.path}`, text: f.text })),
          root,
          { select: false },
        );
        if (!written.length) return false;
        setAdded([...latest.current.filter((l) => l.folder !== lib.name), { folder: lib.name, source }]);
        const hidden = lib.names.filter(isLibraryName);
        if (hidden.length)
          log(`${lib.name} has modules ${hidden.join(", ")} as a library of the build does, Rocq may load either`);
        if (lib.plugins)
          log(`${lib.name} declares OCaml plugins (Declare ML Module), which only the build's packages have in the browser`);
        log(`added the library ${lib.name}`);
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

  const remove = (folder: string) => {
    if (!confirm(`Delete the library ${folder} and its files?`)) return;
    ws.remove(folder);
    setAdded(latest.current.filter((l) => l.folder !== folder));
  };

  return { libraries, progress, error, fromSpec, fromArchive, remove };
}

export type Libraries = ReturnType<typeof useLibraries>;
