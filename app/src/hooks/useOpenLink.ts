// The files of the page's link (?open=SPEC, lib/library.ts's fetchProject):
// a GitHub repository or one of its folders, or an archive's URL, its
// files imported in a folder of their name (a workspace; name_2... when
// the user's folder of that name holds other files, told), the one of
// ?file=NAME opened, else the first Rocq file; the URL then cleaned
// (embedded: kept, its files are in memory only, fetched at each load)
import { useEffect, useRef, useState } from "react";
import { freeFolder } from "../lib/disk";
import { fetchProject, openable } from "../lib/library";
import { embedded, isRocq } from "../lib/storage";
import { root } from "../lib/workspaces";
import type { Workspace } from "./useWorkspace";

const params = new URLSearchParams(location.search);
export const openedSpec = params.get("open")?.trim() || null;

function forget() {
  if (embedded) return;
  const p = new URLSearchParams(location.search);
  p.delete("open");
  p.delete("file");
  history.replaceState(null, "", location.pathname + (p.size ? `?${p}` : "") + location.hash);
}

export function useOpenLink(ws: Workspace, log: (m: string) => void) {
  // what is being fetched, the last error, the folder renamed
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !openedSpec) return;
    started.current = true;
    const spec = openedSpec;
    if (!openable(spec)) {
      const m = `?open=${spec} is neither a GitHub repository (owner/repo[@ref][:folder]) nor an archive's URL`;
      setError(m);
      return log(m);
    }
    (async () => {
      setProgress(`fetching ${spec}`);
      log(`fetching ${spec}`);
      try {
        const { name, files } = await fetchProject(spec, (done, total) =>
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
        const file = params.get("file");
        const active =
          (file && paths.find((p) => p === `${to}/${file}` || p.endsWith(`/${file}`))) ?? paths.find(isRocq);
        if (active) ws.select(active);
        forget();
      } catch (e) {
        const err = e as Error;
        const m =
          err.name === "QuotaExceededError"
            ? `${spec} is too large for the browser's storage of the files (a few MB)`
            : err.message;
        setError(m);
        log(m);
      } finally {
        setProgress(null);
      }
    })();
  }, [log, ws]);
  return {
    progress,
    error,
    notice,
    dismiss: () => {
      setError(null);
      setNotice(null);
    },
  };
}
