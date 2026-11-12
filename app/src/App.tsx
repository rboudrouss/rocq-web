// The page: the header, the panels on the left (chosen by the activity
// bar), the editor, the goals and the panels on the right. The state is in
// the hooks (hooks/), the views in the components (components/).
import { useCallback, useEffect, useRef, useState } from "react";
import { HelpPopover } from "./components/dialogs/HelpPopover";
import { Editor, type EditorHandle } from "./components/editor/Editor";
import { ReadOnlyView } from "./components/editor/ReadOnlyView";
import { FilesPanel } from "./components/files/FilesPanel";
import { Goals } from "./components/goals/Goals";
import { ActivityBar, type PanelId } from "./components/layout/ActivityBar";
import { Banner } from "./components/layout/Banner";
import { Header } from "./components/layout/Header";
import { ExamplesPanel } from "./components/panels/ExamplesPanel";
import { LibrarySearchPanel } from "./components/panels/LibrarySearchPanel";
import { LogPanel } from "./components/panels/LogPanel";
import { OutlinePanel } from "./components/panels/OutlinePanel";
import { PackagesPanel } from "./components/panels/PackagesPanel";
import { ProblemsPanel } from "./components/panels/ProblemsPanel";
import { QueryPanel } from "./components/panels/QueryPanel";
import { Tabs } from "./components/panels/Tabs";
import { useDocument } from "./hooks/useDocument";
import { useLog } from "./hooks/useLog";
import { useNavigation } from "./hooks/useNavigation";
import { usePersistentState } from "./hooks/usePersistentState";
import { useQueries } from "./hooks/useQueries";
import { useRocqSession } from "./hooks/useRocqSession";
import { useWorkspace } from "./hooks/useWorkspace";
import { pickBuild } from "./lib/detect";
import { saveBlob } from "./lib/download";
import { navLabel } from "./lib/keys";
import { type Example, exampleFiles } from "./lib/examples";
import { shareUrl } from "./lib/share";
import { embedded } from "./lib/storage";
import { root } from "./lib/workspaces";

const compatWarning =
  "This browser runs the compatibility build of Rocq (no WebAssembly JSPI or memory64), slower and limited to 4 GB of memory. Chrome or Edge 137 and later run the full build.";

export function App() {
  const [build] = useState(pickBuild);
  const { lines, log } = useLog();
  const ws = useWorkspace(log);
  const session = useRocqSession({ build, ws, log });
  const editor = useRef<EditorHandle>(null);
  const doc = useDocument({ session, ws, editor, log });
  const nav = useNavigation({ session, ws, doc, editor, packages: session.packages, log });
  const queries = useQueries({ session, ws, doc });

  const [panel, setPanel] = usePersistentState<PanelId | null>("panel", "files");
  const [help, setHelp] = useState(false);
  const [shared, setShared] = useState<string | null>(null);
  // (the compatibility build: told once, in the log too)
  const [compatSeen, setCompatSeen] = usePersistentState("compat-warning", false);
  useEffect(() => {
    if (build === "compat") log(compatWarning);
  }, [build, log]);
  const active = ws.active;

  const share = async () => {
    const url = await shareUrl(active, ws.read(active));
    await navigator.clipboard?.writeText(url).catch(() => {});
    log(`link to ${active} copied (${url.length} characters)`);
    setShared(url);
  };
  // The page with this file, not embedded
  const openFull = async () => {
    const url = new URL(await shareUrl(active, ws.read(active)));
    url.search = "";
    window.open(url.href, "_blank", "noopener");
  };
  const openExample = async (e: Example) => {
    try {
      ws.importFiles(await exampleFiles(e), root);
    } catch (err) {
      log((err as Error).message);
    }
  };
  const downloadProduced = useCallback(
    async (path: string) => {
      const data = await session.client.current?.readFile(`/workspace/${path}`).catch(() => null);
      if (data) saveBlob(new Blob([data as Uint8Array<ArrayBuffer>]), path.split("/").pop()!);
    },
    [session.client],
  );
  const insertLine = (line: string) => {
    nav.closeReadOnly();
    editor.current?.insertLine(line);
  };

  const problemsBadge = doc.depError || doc.diagnostics.some((d) => d.severity === 1);
  return (
    <div className={embedded ? "app embed" : "app"}>
      <Header
        status={session.status}
        fetching={session.fetching}
        file={active}
        stepByStep={doc.stepByStep}
        changeMode={doc.changeMode}
        move={doc.move}
        embedded={embedded}
        restart={session.restart}
        share={share}
        openFull={openFull}
        help={() => setHelp(!help)}
      />
      {help && <HelpPopover close={() => setHelp(false)} />}
      {build === "compat" && !compatSeen && !embedded && (
        <Banner kind="warning" close={() => setCompatSeen(true)}>
          {compatWarning}
        </Banner>
      )}
      {shared && (
        <Banner close={() => setShared(null)}>
          Link copied to the clipboard <input readOnly value={shared} onFocus={(e) => e.target.select()} />
        </Banner>
      )}
      <main className={panel && !embedded ? "with-sidebar" : ""}>
        {!embedded && <ActivityBar shown={panel} show={setPanel} />}
        <aside className="left" hidden={embedded || panel === null}>
          <div className="sidebar" hidden={panel !== "files"}>
            <FilesPanel
              ws={ws}
              produced={doc.produced}
              viewProduced={nav.viewProduced}
              downloadProduced={downloadProduced}
              log={log}
            />
          </div>
          <div className="sidebar" hidden={panel !== "outline"}>
            <OutlinePanel symbols={doc.symbols} goTo={nav.goTo} />
          </div>
          <div className="sidebar" hidden={panel !== "search"}>
            <LibrarySearchPanel
              url={`${session.assets}search.tsv`}
              open={(d) => {
                const at = { line: d.line - 1, character: 0 };
                nav.showLocation({ path: d.path }, { start: at, end: at }, d.name);
              }}
            />
          </div>
          <div className="sidebar" hidden={panel !== "packages"}>
            <PackagesPanel packages={session.packages} insert={insertLine} />
          </div>
          <div className="sidebar" hidden={panel !== "examples"}>
            <ExamplesPanel open={openExample} log={log} />
          </div>
        </aside>
        <section className="center">
          <div className="editor-wrap" hidden={nav.readOnly !== null}>
            <Editor
              key={active}
              ref={editor}
              initial={ws.read(active)}
              at={nav.pendingGoTo.current ?? undefined}
              onChange={doc.onChange}
              onCursor={doc.onCursor}
              hover={doc.hover}
              complete={doc.complete}
              definition={nav.definition}
              keys={doc.keys}
            />
          </div>
          {nav.readOnly && <ReadOnlyView file={nav.readOnly} back={nav.closeReadOnly} backTo={active} />}
        </section>
        <aside className="right">
          <h2>Goals</h2>
          <div className="goals" data-testid="goals">
            <Goals
              result={doc.goals?.now ?? null}
              before={doc.goals?.before ?? null}
              hint={
                doc.stepByStep
                  ? `Nothing checked yet. ${navLabel("ArrowDown")} checks the next sentence, ${navLabel("ArrowRight")} up to the cursor.`
                  : undefined
              }
              error={doc.stopped}
            />
          </div>
          <Tabs
            tabs={[
              [
                "Problems",
                <ProblemsPanel diagnostics={doc.diagnostics} goTo={nav.goTo} depError={doc.depError} />,
                <>
                  Problems
                  {problemsBadge && <span className="badge"> •</span>}
                </>,
              ],
              ["Query", <QueryPanel results={queries.results} run={queries.run} />],
              ["Log", <LogPanel lines={lines} />],
            ]}
          />
        </aside>
      </main>
    </div>
  );
}
