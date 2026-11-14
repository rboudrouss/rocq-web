// The page: the header, the panels on the left (chosen by the activity
// bar), the editor, the goals and the panels on the right. On a phone, the
// panels on the left over the page (the header's button), the editor over
// the goals, the moves between them; the keyboard open, the goals on a line
// over it. The state is in the hooks (hooks/), the views in the components
// (components/).
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { HelpPopover } from "./components/dialogs/HelpPopover";
import { Editor, type EditorHandle } from "./components/editor/Editor";
import { ReadOnlyView } from "./components/editor/ReadOnlyView";
import { FilesPanel } from "./components/files/FilesPanel";
import { Goals } from "./components/goals/Goals";
import { ActivityBar, type PanelId } from "./components/layout/ActivityBar";
import { Banner } from "./components/layout/Banner";
import { Header } from "./components/layout/Header";
import { KeyboardBar } from "./components/layout/KeyboardBar";
import { StepBar } from "./components/layout/StepBar";
import { ExamplesPanel } from "./components/panels/ExamplesPanel";
import { LibrarySearchPanel } from "./components/panels/LibrarySearchPanel";
import { LogPanel } from "./components/panels/LogPanel";
import { OutlinePanel } from "./components/panels/OutlinePanel";
import { PackagesPanel } from "./components/panels/PackagesPanel";
import { ProblemsPanel } from "./components/panels/ProblemsPanel";
import { QueryPanel } from "./components/panels/QueryPanel";
import { Tabs } from "./components/panels/Tabs";
import { useDocument } from "./hooks/useDocument";
import { useLibraries } from "./hooks/useLibraries";
import { useLog } from "./hooks/useLog";
import { useKeyboard, useMobile } from "./hooks/useMobile";
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
  const libs = useLibraries(ws, log);

  const [panel, setPanel] = usePersistentState<PanelId | null>("panel", "files");
  const mobile = useMobile();
  const keyboard = useKeyboard(mobile);
  // (a phone) the panels shown, over the page; the editor's part of the height
  const [drawer, setDrawer] = useState(false);
  const [split, setSplit] = usePersistentState("split", 0.55);
  const main = useRef<HTMLElement>(null);
  const shown = mobile ? (panel ?? "files") : panel;
  // (a phone) the panels closed once they did their work
  const closing =
    <A extends unknown[]>(f: (...a: A) => void) =>
    (...a: A) => {
      setDrawer(false);
      f(...a);
    };
  const [help, setHelp] = useState(false);
  // (the Packages panel's form focused: the Files panel's "Add a library")
  const [focusAdd, setFocusAdd] = useState(0);
  const addLibrary = () => {
    setPanel("packages");
    setFocusAdd((n) => n + 1);
  };
  // A library's folder: its first file opened in the Files panel
  const showFolder = (folder: string) => {
    setPanel("files");
    const first = ws.files.find((f) => f.startsWith(`${folder}/`) && f.endsWith(".v"));
    if (first) ws.select(first);
  };
  const [shared, setShared] = useState<string | null>(null);
  // (the compatibility build: told once, in the log too)
  const [compatSeen, setCompatSeen] = usePersistentState("compat-warning", false);
  useEffect(() => {
    if (build === "compat") log(compatWarning);
  }, [build, log]);
  const active = ws.active;
  useEffect(() => setDrawer(false), [active, nav.readOnly]);

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
  const hint = doc.stepByStep
    ? mobile
      ? "Nothing checked yet. ↓ checks the next sentence, a line's number up to it."
      : `Nothing checked yet. ${navLabel("ArrowDown")} checks the next sentence, ${navLabel("ArrowRight")} up to the cursor.`
    : undefined;
  const goals = (
    <div className="goals" data-testid="goals">
      <Goals result={doc.goals?.now ?? null} before={doc.goals?.before ?? null} hint={hint} error={doc.stopped} />
    </div>
  );
  const problems = <ProblemsPanel diagnostics={doc.diagnostics} goTo={nav.goTo} depError={doc.depError} />;
  const problemsLabel = (
    <>
      Problems
      {problemsBadge && <span className="badge"> •</span>}
    </>
  );
  const query = <QueryPanel results={queries.results} run={queries.run} />;
  const logPanel = <LogPanel lines={lines} />;
  return (
    <div className={["app", embedded && "embed", mobile && "mobile", keyboard && "keyboard"].filter(Boolean).join(" ")}>
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
        mobile={mobile}
        panels={embedded ? undefined : () => setDrawer(!drawer)}
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
      <main
        ref={main}
        className={panel && !embedded && !mobile ? "with-sidebar" : ""}
        style={mobile ? ({ "--split": `${split * 100}%` } as CSSProperties) : undefined}
      >
        {!embedded && !mobile && <ActivityBar shown={panel} show={setPanel} />}
        <aside className="left" hidden={embedded || (mobile ? !drawer : panel === null)}>
          {mobile && <ActivityBar shown={shown} show={(p) => p && setPanel(p)} />}
          <div className="sidebar" hidden={shown !== "files"}>
            <FilesPanel
              ws={ws}
              produced={doc.produced}
              viewProduced={nav.viewProduced}
              downloadProduced={downloadProduced}
              log={log}
              libs={libs}
              addLibrary={addLibrary}
            />
          </div>
          <div className="sidebar" hidden={shown !== "outline"}>
            <OutlinePanel symbols={doc.symbols} goTo={closing(nav.goTo)} />
          </div>
          <div className="sidebar" hidden={shown !== "search"}>
            <LibrarySearchPanel
              url={`${session.assets}search.tsv`}
              open={closing((d) => {
                const at = { line: d.line - 1, character: 0 };
                nav.showLocation({ path: d.path }, { start: at, end: at }, d.name);
              })}
            />
          </div>
          <div className="sidebar" hidden={shown !== "packages"}>
            <PackagesPanel
              packages={session.packages}
              libs={libs}
              insert={closing(insertLine)}
              showFolder={showFolder}
              focusAdd={focusAdd}
            />
          </div>
          <div className="sidebar" hidden={shown !== "examples"}>
            <ExamplesPanel open={closing(openExample)} log={log} />
          </div>
        </aside>
        {mobile && drawer && <div className="scrim" onClick={() => setDrawer(false)} />}
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
              lineClick={mobile ? (p) => doc.move("cursor", p) : undefined}
              focusOnGoTo={!mobile}
            />
          </div>
          {nav.readOnly && <ReadOnlyView file={nav.readOnly} back={nav.closeReadOnly} backTo={active} />}
        </section>
        {mobile && !keyboard && <StepBar move={doc.move} main={main} split={setSplit} />}
        <aside className="right">
          {mobile ? (
            <Tabs
              tabs={[
                ["Goals", goals],
                ["Problems", problems, problemsLabel],
                ["Query", query],
                ["Log", logPanel],
              ]}
            />
          ) : (
            <>
              <h2>Goals</h2>
              {goals}
              <Tabs
                tabs={[
                  ["Problems", problems, problemsLabel],
                  ["Query", query],
                  ["Log", logPanel],
                ]}
              />
            </>
          )}
        </aside>
        {mobile && keyboard && (
          <KeyboardBar
            result={doc.goals?.now ?? null}
            before={doc.goals?.before ?? null}
            error={doc.stopped}
            hint={doc.stepByStep ? "Nothing checked yet" : "Move the cursor into a proof"}
            move={doc.move}
            insert={(t) => editor.current?.insert(t)}
          />
        )}
      </main>
    </div>
  );
}
