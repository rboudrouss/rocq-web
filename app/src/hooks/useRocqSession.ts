// Rocq's worker (coq-lsp's server, lib/lsp.ts) for the page: started, and
// again on Restart; the user's files copied to its file system
// (/workspace, for Load, Extraction and the project files), each workspace
// registered as a workspace folder of coq-lsp with its project file, read
// again when it changes; its status, the libraries' files it downloads, the
// opam packages of the build.
import { useCallback, useEffect, useRef, useState } from "react";
import { LspClient } from "../lib/lsp";
import { Project } from "../lib/project";
import { isProject } from "../lib/storage";
import { customProject, generatedProject, projectOf, root, workerDir, workspaceOf } from "../lib/workspaces";
import type { Package } from "../components/panels/PackagesPanel";
import type { Workspace } from "./useWorkspace";

const base = import.meta.env.BASE_URL;

// What the active document listens to (hooks/useDocument.ts)
export type SessionEvents = {
  diagnostics?: (uri: string, version: number, diagnostics: import("../lib/lsp").Diagnostic[]) => void;
  progress?: (uri: string, ranges: import("../lib/lsp").Range[]) => void;
  idle?: () => void;
  // a workspace's project changed: its documents opened again
  workspacesChanged?: () => void;
};

export function useRocqSession({ build, ws, log }: { build: string; ws: Workspace; log: (m: string) => void }) {
  const assets = `${base}rocq/${build}/`;
  const client = useRef<LspClient | null>(null);
  const project = useRef<Project | null>(null);
  const ready = useRef(false);
  // incremented when a server is ready (the documents opened in it)
  const [started, setStarted] = useState(0);
  const [status, setStatus] = useState("starting");
  const [fetching, setFetching] = useState<{ path: string; files: number; bytes: number } | null>(null);
  const [packages, setPackages] = useState<Package[] | null>(null);
  const [generation, setGeneration] = useState(0);
  const events = useRef<SessionEvents>({});
  // (whether Rocq checks only on request, read when it starts)
  const checkOnRequest = useRef(false);
  const wsRef = useRef(ws);
  wsRef.current = ws;
  // the workspaces registered in coq-lsp, with the text of their project
  const registered = useRef(new Map<string, string>());
  // The project files written to the worker (an edit is written once
  // saved): Rocq reads those
  const written = useRef(new Map<string, string>());
  const readWritten = useCallback((name: string) => written.current.get(name) ?? wsRef.current.read(name), []);

  // The project files of the workspaces as Rocq reads them: [dir, text]
  const projects = useCallback(() => {
    const { files, workspaces } = wsRef.current.current.current;
    return [...workspaces, root].map((d) => [d, projectOf(d, files, readWritten).text] as const);
  }, [readWritten]);

  // The generated project files in the worker (those the user did not
  // write: a _CoqProject of the user's without the generated _RocqProject
  // next to it, which coq-lsp would read first)
  const writeGenerated = useCallback((c: LspClient, dirs: string[]) => {
    const { files } = wsRef.current.current.current;
    return Promise.all(
      dirs.map((d) => {
        const custom = customProject(d, files);
        const path = `${workerDir(d)}/_RocqProject`;
        if (!custom) return c.writeFile(path, generatedProject(d)).catch(() => {});
        return custom.endsWith("_CoqProject") ? c.removeFile(path).catch(() => {}) : Promise.resolve();
      }),
    );
  }, []);

  // The workspaces of coq-lsp made those of the files (after a change of
  // the workspaces or of a project file): those whose project changed
  // removed and added again (the root's: all of them, as coq-lsp searches
  // them from the last added, the root last)
  const syncTimer = useRef<number | undefined>(undefined);
  // (done when the last change is: documents are opened after it)
  const synced = useRef<{ promise: Promise<void>; done: () => void } | null>(null);
  const whenSynced = useCallback(() => synced.current?.promise ?? Promise.resolve(), []);
  const syncWorkspaces = useCallback(() => {
    window.clearTimeout(syncTimer.current);
    if (!synced.current) {
      let done = () => {};
      const promise = new Promise<void>((ok) => (done = ok));
      synced.current = { promise, done };
    }
    syncTimer.current = window.setTimeout(async () => {
      const s = synced.current;
      synced.current = null;
      try {
        await sync();
      } finally {
        s?.done();
      }
    }, 300);
    const sync = async () => {
      const c = client.current;
      if (!c || !ready.current) return;
      const want = new Map(projects());
      const have = registered.current;
      const changed = [...want].filter(([d, t]) => have.get(d) !== t).map(([d]) => d);
      const removed = [...have.keys()].filter((d) => !want.has(d));
      if (changed.length === 0 && removed.length === 0) return;
      await writeGenerated(c, changed);
      if (changed.includes(root) || removed.length) {
        c.changeWorkspaces([], [...have.keys()].map(workerDir));
        c.changeWorkspaces([workerDir(root)], []);
        c.changeWorkspaces([...want.keys()].filter((d) => d !== root).map(workerDir), []);
      } else
        for (const d of changed) {
          if (have.has(d)) c.changeWorkspaces([], [workerDir(d)]);
          c.changeWorkspaces([workerDir(d)], []);
        }
      registered.current = want;
      // (coq-lsp's caches keep the states of the former load paths)
      c.notify("coq/trimCaches", {});
      project.current?.forget();
      log(`workspaces read again: ${[...changed, ...removed].map((d) => d || "(root)").join(", ")}`);
      events.current.workspacesChanged?.();
    };
  }, [log, projects, writeGenerated]);

  // A file of the user's written to the worker's
  const write = useCallback(
    (path: string, text: string | null) => {
      const c = client.current;
      if (!c) return;
      if (isProject(path)) {
        if (text === null) written.current.delete(path);
        else written.current.set(path, text);
      }
      const done = text !== null ? c.writeFile(`/workspace/${path}`, text) : c.removeFile(`/workspace/${path}`);
      done.catch((e: Error) => log(`${path}: ${e.message}`));
      if (isProject(path)) syncWorkspaces();
    },
    [log, syncWorkspaces],
  );

  useEffect(() => {
    const c = new LspClient(
      `${base}rocq/worker.js?build=${build}`,
      {
        diagnostics: (u, v, ds) => events.current.diagnostics?.(u, v, ds),
        fetch: (path, size) =>
          setFetching((f) => ({ path, files: (f?.files ?? 0) + 1, bytes: (f?.bytes ?? 0) + size })),
        status: (s) => {
          setStatus(s);
          if (s === "Idle") {
            setFetching(null);
            events.current.idle?.();
          }
        },
        progress: (u, rs) => events.current.progress?.(u, rs),
        log,
      },
      { channel: build === "compat" },
    );
    client.current = c;
    ready.current = false;
    setStatus("starting");
    const w = wsRef.current;
    project.current = new Project(c, () => w.current.current.files, () => w.current.current.workspaces, w.read, log);
    // the files, and the generated project files, before Rocq starts
    const { files, workspaces } = w.current.current;
    written.current = new Map(files.filter(isProject).map((f) => [f, w.read(f)]));
    for (const f of files) c.writeFile(`/workspace/${f}`, w.read(f)).catch(() => {});
    const dirs = [...workspaces, root];
    writeGenerated(c, dirs);
    registered.current = new Map(projects());
    w.setMirror({ write, workspacesChanged: syncWorkspaces });
    (window as unknown as { rocq: LspClient }).rocq = c;
    const t0 = performance.now();
    c.initialize(checkOnRequest.current, dirs.map(workerDir)).then(() => {
      log(`server ready in ${Math.round(performance.now() - t0)} ms`);
      ready.current = true;
      // (busy once it checks a file)
      setStatus("Idle");
      setStarted((n) => n + 1);
    });
    fetch(`${assets}packages.json`)
      .then((r) => r.json())
      .then(setPackages, () => setPackages([]));
    const flush = () => w.flush();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      w.setMirror(null);
      c.terminate();
    };
  }, [build, assets, generation, log, projects, syncWorkspaces, write, writeGenerated]);

  const restart = useCallback(() => {
    wsRef.current.flush();
    setGeneration((g) => g + 1);
  }, []);

  // The workspace a file is in (its folder of coq-lsp)
  const workspaceOfFile = useCallback((path: string) => workspaceOf(path, wsRef.current.current.current.workspaces), []);

  return {
    assets,
    client,
    project,
    ready,
    started,
    status,
    fetching,
    packages,
    events,
    checkOnRequest,
    restart,
    syncWorkspaces,
    whenSynced,
    workspaceOfFile,
  };
}

export type Session = ReturnType<typeof useRocqSession>;
