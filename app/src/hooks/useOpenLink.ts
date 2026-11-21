// The files of the page's link (?open=SPEC, repeated; lib/library.ts's
// fetchProject): a GitHub repository or one of its folders, or an archive's
// URL, its files imported in a folder of their name (a workspace; name_2...
// when the user's folder of that name holds other files, told), the one of
// ?file=NAME opened, else the first Rocq file; the URL then cleaned
// (temporary: kept, its files are in memory only, fetched at each load).
// The folders opened so are kept with their source, which the Share dialog
// puts in a link instead of their files.
import { useEffect, useRef, useState } from "react";
import { freeFolder } from "../lib/disk";
import { fetchProject, openable } from "../lib/library";
import { example, isRocq, temporary } from "../lib/storage";
import { root } from "../lib/workspaces";
import { usePersistentState } from "./usePersistentState";
import type { Workspace } from "./useWorkspace";

const params = new URLSearchParams(location.search);
export const openedSpecs = [...new Set(params.getAll("open").map((s) => s.trim()).filter(Boolean))];

// (folder: where its files are; source: the spec; pinned: the spec at the
// commit fetched, when it named no ref)
export type Opened = { folder: string; source: string; pinned?: string };
// Its spec in a link
export const openSource = (o: Opened) => o.pinned ?? o.source;

function forget() {
  if (temporary) return;
  const p = new URLSearchParams(location.search);
  p.delete("open");
  p.delete("file");
  history.replaceState(null, "", location.pathname + (p.size ? `?${p}` : "") + location.hash);
}

export function useOpenLink(ws: Workspace, log: (m: string) => void) {
  // (temporary: in memory, as its files are)
  const persisted = usePersistentState<Opened[]>("opened", []);
  const inMemory = useState<Opened[]>([]);
  const [recorded, setRecorded] = temporary ? inMemory : persisted;
  const latest = useRef(recorded);
  latest.current = recorded;
  // what is being fetched, the last error, the folder renamed
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const open = async (spec: string) => {
    if (!openable(spec)) throw new Error(`?open=${spec} is neither a GitHub repository (owner/repo[@ref][:folder]) nor an archive's URL`);
    setProgress(`fetching ${spec}`);
    log(`fetching ${spec}`);
    const { name, files, pinned } = await fetchProject(spec, (done, total) =>
      setProgress(`fetching ${spec}: ${done} of ${total} files`),
    );
    if (!files.some((f) => isRocq(f.path))) throw new Error(`${spec} has no Rocq files (.v)`);
    const { files: mine, folders, workspaces } = ws.current.current;
    const to = freeFolder(name, files, { files: mine, folders: [...folders, ...workspaces] }, ws.read);
    if (to !== name) {
      const m = `The folder ${name}/ already holds other files: the link's files are in ${to}/, yours are unchanged`;
      setNotice(m);
      log(m);
    }
    const paths = ws.importFiles(
      files.map((f) => ({ path: `${to}/${f.path}`, text: f.text })),
      root,
      { select: false },
    );
    if (paths.length)
      setRecorded([
        ...latest.current.filter((o) => o.folder !== to),
        { folder: to, source: spec, ...(pinned && { pinned }) },
      ]);
    return { to, paths };
  };

  const started = useRef(false);
  useEffect(() => {
    if (started.current || openedSpecs.length === 0) return;
    started.current = true;
    (async () => {
      const opened: { to: string; paths: string[] }[] = [];
      for (const spec of openedSpecs)
        try {
          opened.push(await open(spec));
        } catch (e) {
          const err = e as Error;
          const m =
            err.name === "QuotaExceededError"
              ? `${spec} is too large for the browser's storage of the files (a few MB)`
              : err.message;
          setError(m);
          log(m);
        }
      setProgress(null);
      const file = params.get("file");
      const all = opened.flatMap((o) => o.paths);
      const named = file
        ? (opened.flatMap((o) => o.paths.filter((p) => p === `${o.to}/${file}`))[0] ?? all.find((p) => p.endsWith(`/${file}`)))
        : undefined;
      const active = named ?? all.find(isRocq);
      if (active) ws.select(active);
      // (a temporary session: the scratch file, untouched, not beside them)
      if (temporary && active && ws.current.current.files.includes("scratch.v") && ws.read("scratch.v") === example)
        ws.remove("scratch.v", false);
      if (opened.length) forget();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, ws]);

  // (those whose folder is still there)
  const { files } = ws;
  const openedFolders = recorded.filter((o) => files.some((f) => f.startsWith(`${o.folder}/`)));
  return {
    progress,
    error,
    notice,
    openedFolders,
    dismiss: () => {
      setError(null);
      setNotice(null);
    },
  };
}
