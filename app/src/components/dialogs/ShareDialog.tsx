// The Share button's dialog: a link, or the HTML that embeds the page in
// another one, made again and copied at each change of what it shares: the
// current file or all of them, the user's libraries that can be fetched
// again (?lib=SPEC), the folders opened from a repository or an archive
// (?open=SPEC: their files then left out, the current one ?file=NAME),
// others for the link only (a GitHub repository pinned to its last commit
// by default), a temporary session (?temp: by default when it opens
// folders; an embed always is one). A warning when the link is too long,
// and (i) buttons that tell more.
import { Code, Copy, FolderInput, Info, Link, PackagePlus, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { fetchable, type Libraries, linkSource } from "../../hooks/useLibraries";
import { type Opened, openSource } from "../../hooks/useOpenLink";
import type { Workspace } from "../../hooks/useWorkspace";
import { gitHubFolder, gitHubRepository, isCommit, latestCommit, openable, openSpec } from "../../lib/library";
import { embedCode, embedUrl, longUrl, maxUrl, type Shared, shareUrl, workspacesOf } from "../../lib/share";

// What the dialog shares when it opens (file: the current one; libraries:
// their sources, checked)
export type ShareStart = { file: boolean; libraries: string[] };

type Props = {
  start: ShareStart;
  ws: Workspace;
  libs: Libraries;
  // (the folders opened by a link, ?open=SPEC)
  opened: Opened[];
  log: (m: string) => void;
  close: () => void;
};

const plural = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

// A heading or a line with an (i) that shows, under it, more about it
function More({ children, more }: { children: ReactNode; more: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="with-info">
        {children}
        <button
          type="button"
          className="info"
          aria-expanded={open}
          aria-label="More about this"
          title="More about this"
          onClick={() => setOpen(!open)}
        >
          <Info size={14} />
        </button>
      </div>
      {open && <div className="info-text">{more}</div>}
    </>
  );
}

// A GitHub repository's spec pinned to the last commit of its ref (its
// default branch), unless it names a commit
async function pinnedSpec<T extends { owner: string; repo: string; ref: string | null }>(
  gh: T,
  spec: (gh: T) => string,
): Promise<string> {
  if (gh.ref && isCommit(gh.ref)) return spec(gh);
  return spec({ ...gh, ref: await latestCommit(gh.owner, gh.repo, gh.ref ?? "HEAD") });
}

export function ShareDialog({ start, ws, libs, opened, log, close }: Props) {
  const [embed, setEmbed] = useState(false);
  // (a temporary session, chosen: else when the link opens folders)
  const [temp, setTemp] = useState<boolean | null>(null);
  const [file, setFile] = useState(start.file);
  const [all, setAll] = useState(false);
  const [checked, setChecked] = useState(() => new Set(start.libraries));
  // (the libraries added here: their sources, in order)
  const [extra, setExtra] = useState<string[]>(() => {
    const known = new Set(libs.libraries.map(linkSource));
    return start.libraries.filter((s) => !known.has(s));
  });
  const [spec, setSpec] = useState("");
  const [pin, setPin] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // (the folders the link opens from their source, checked; those added
  // here; the form's)
  const [openChecked, setOpenChecked] = useState(() => new Set<string>());
  const [openExtra, setOpenExtra] = useState<string[]>([]);
  const [openSpecText, setOpenSpecText] = useState("");
  const [openError, setOpenError] = useState<string | null>(null);
  // the link (what is copied: it, or the HTML of the embed)
  const [link, setLink] = useState("");
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const mine = libs.libraries.filter((l) => fetchable(l.source));
  const fromDisk = libs.libraries.filter((l) => !fetchable(l.source));
  // (the folders the link opens: their files left out, the current one
  // named by ?file)
  const reopened = opened.filter((o) => openChecked.has(openSource(o))).map((o) => o.folder);
  const inReopened = (f: string) => reopened.some((d) => f.startsWith(`${d}/`));
  const activeFolder = reopened.find((d) => ws.active.startsWith(`${d}/`));
  // (all the files: those of the libraries that a link can fetch, and of
  // the folders it opens, left out)
  const allFiles = ws.files.filter((f) => !mine.some((l) => f.startsWith(`${l.folder}/`)) && !inReopened(f));
  const sources = [...mine.map(linkSource), ...extra].filter((s) => checked.has(s));
  const opens = [...opened.map(openSource), ...openExtra].filter((s) => openChecked.has(s));
  const shownFile = activeFolder && (file || all) ? ws.active.slice(activeFolder.length + 1) : undefined;
  const temporary = embed || (temp ?? opens.length > 0);
  const text = embed ? embedCode(embedUrl(link)) : link;

  const shared = (): Shared => {
    const paths = all ? allFiles : file && !activeFolder ? [ws.active] : [];
    return {
      active: paths.includes(ws.active) ? ws.active : null,
      files: paths.map((p) => [p, ws.read(p)]),
      workspaces: workspacesOf(paths, ws.workspaces),
    };
  };

  const copy = async (t: string) => {
    const ok = await navigator.clipboard?.writeText(t).then(
      () => true,
      () => false,
    );
    return ok;
  };

  // The link made again, and copied
  const key = JSON.stringify([file, all, sources, opens, shownFile, embed, temporary]);
  useEffect(() => {
    let current = true;
    const s = shared();
    shareUrl(s, sources, new URL(location.pathname, location.href).href, {
      open: opens,
      file: shownFile,
      temp: temporary && !embed,
    }).then(async (u) => {
      if (!current) return;
      setLink(u);
      const ok = await copy(embed ? embedCode(embedUrl(u)) : u);
      if (!current) return;
      const what = [
        s.files.length && plural(s.files.length, "file"),
        opens.length && plural(opens.length, "opened folder"),
        sources.length && plural(sources.length, "library"),
      ];
      log(
        `${embed ? "embed" : temporary ? "temporary link" : "link"}${what.some(Boolean) ? ` with ${what.filter(Boolean).join(" and ")}` : ""} ${ok ? "copied" : "made"} (${u.length} characters)`,
      );
    });
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [close]);

  const flip = (source: string) => (c: Set<string>) => {
    const n = new Set(c);
    if (n.has(source)) n.delete(source);
    else n.add(source);
    return n;
  };
  const toggle = (source: string) => setChecked(flip(source));
  const toggleOpen = (source: string) => setOpenChecked(flip(source));

  // A library for the link: a GitHub repository pinned to the last commit
  // of its ref (its default branch) if asked, an archive's URL as it is
  const add = async () => {
    const s = spec.trim();
    if (!s || adding) return;
    setError(null);
    const gh = gitHubRepository(s);
    if (!gh && !fetchable(s)) return setError(`${s} is neither a GitHub repository (owner/repo) nor an archive's URL`);
    setAdding(true);
    try {
      const repoSpec = (g: { owner: string; repo: string; ref: string | null }) =>
        `${g.owner}/${g.repo}${g.ref ? `@${g.ref}` : ""}`;
      const source = gh ? (pin ? await pinnedSpec(gh, repoSpec) : repoSpec(gh)) : s;
      if (!mine.some((l) => linkSource(l) === source)) setExtra((e) => (e.includes(source) ? e : [...e, source]));
      setChecked((c) => new Set(c).add(source));
      setSpec("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  // A folder for the link to open: a GitHub repository's (pinned as a
  // library is), an archive's URL as it is
  const addOpen = async () => {
    const s = openSpecText.trim();
    if (!s || adding) return;
    setOpenError(null);
    if (!openable(s)) return setOpenError(`${s} is neither a GitHub repository (owner/repo[:folder]) nor an archive's URL`);
    const gh = gitHubFolder(s);
    setAdding(true);
    try {
      const source = gh ? (pin ? await pinnedSpec(gh, openSpec) : openSpec(gh)) : s;
      if (!opened.some((o) => openSource(o) === source)) setOpenExtra((e) => (e.includes(source) ? e : [...e, source]));
      setOpenChecked((c) => new Set(c).add(source));
      setOpenSpecText("");
    } catch (e) {
      setOpenError((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  const length = embed ? embedUrl(link).length : link.length;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog share-dialog" role="dialog" aria-label="Share">
        <div className="dialog-title">
          <h2>Share</h2>
          <button className="icon" onClick={close} aria-label="Close" title="Close">
            <X size={16} />
          </button>
        </div>

        <More
          more={
            <>
              <p>
                <b>Link</b> opens rocq-web with what is checked below. The files travel inside the link, after its{" "}
                <code>#</code>, and are never uploaded.
              </p>
              <p>
                <b>Embed</b> gives an <code>&lt;iframe&gt;</code> to paste in another site, such as a course or a
                blog. It keeps its files in memory and saves nothing in the visitor's browser.
              </p>
              <p>
                It works in any page in Chrome and Edge 137+ and in Firefox 153+. Editing there does not stop a long
                computation, but Restart does.
              </p>
              <p>
                Safari and older browsers need the page around it to be cross-origin isolated. Serve that page with{" "}
                <code>Cross-Origin-Opener-Policy: same-origin</code> and{" "}
                <code>Cross-Origin-Embedder-Policy: require-corp</code>, or <code>credentialless</code>, which is
                less strict with the page's other resources. This HTML already has the{" "}
                <code>allow="cross-origin-isolated"</code> attribute that the iframe also needs.
              </p>
            </>
          }
        >
          <div className="segmented" role="group" aria-label="What to share">
            <button aria-pressed={!embed} onClick={() => setEmbed(false)}>
              <Link size={14} /> Link
            </button>
            <button aria-pressed={embed} onClick={() => setEmbed(true)}>
              <Code size={14} /> Embed
            </button>
          </div>
        </More>
        <div className="share-link">
          {embed ? (
            <textarea
              ref={field}
              readOnly
              rows={4}
              value={text}
              aria-label="The HTML"
              onFocus={(e) => e.target.select()}
            />
          ) : (
            <input ref={field} readOnly value={text} aria-label="The link" onFocus={(e) => e.target.select()} />
          )}
          <button
            className="button"
            onClick={async () => (await copy(text)) || field.current?.select()}
            title={embed ? "Copy the HTML" : "Copy the link"}
          >
            <Copy size={14} /> Copy
          </button>
        </div>
        {length > maxUrl ? (
          <p className="share-warning error">
            Chrome and Edge cannot open links over 2 MB. Share fewer files, or send them as an archive.
          </p>
        ) : (
          length > longUrl && (
            <p className="share-warning">
              Chat apps, mail and some sites may cut links over 8 KB. Share fewer files, or send them as an
              archive.
            </p>
          )
        )}

        <More
          more={
            <>
              <p>
                A temporary session keeps its files in memory: it neither reads nor changes the visitor's own files,
                and closing the page forgets it. It suits a tutorial or a demo that students open once, without
                filling their workspace. A banner tells them, with a button to keep the files.
              </p>
              <p>An embed is always one.</p>
            </>
          }
        >
          <label>
            <input
              type="checkbox"
              checked={temporary}
              disabled={embed}
              onChange={(e) => setTemp(e.target.checked)}
            />
            <span>
              Temporary session{" "}
              <span className="muted">{embed ? "always, for an embed" : "nothing saved in the visitor's browser"}</span>
            </span>
          </label>
        </More>

        <More
          more={
            <p>
              Opening the link copies the files into the visitor's browser, unless the session is temporary. A file whose path they already use
              with another text is renamed, as <code>A_1.v</code> or a folder <code>W_2/</code>. All files leaves
              out the libraries that the link adds by itself.
            </p>
          }
        >
          <h3>Files</h3>
        </More>
        <label>
          <input type="checkbox" checked={file || all} disabled={all} onChange={(e) => setFile(e.target.checked)} />
          <span>
            This file{" "}
            <span className="muted">
              {ws.active}
              {activeFolder && `, opened from ${activeFolder}/'s source`}
            </span>
          </span>
        </label>
        <label>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          <span>
            All files <span className="muted">{plural(allFiles.length, "file")}</span>
          </span>
        </label>

        <More
          more={
            <>
              <p>
                The link fetches the checked folders again from their GitHub repository or archive, with one{" "}
                <code>?open=</code> each, instead of carrying their files: it stays short whatever their size. If
                This file is in one of them, <code>&amp;file=</code> opens it.
              </p>
              <p>Changes made to these files since they were opened are not in the link.</p>
            </>
          }
        >
          <h3>Opened folders</h3>
        </More>
        {opened.map((o) => (
          <label key={o.folder}>
            <input type="checkbox" checked={openChecked.has(openSource(o))} onChange={() => toggleOpen(openSource(o))} />
            <span>
              {o.folder}/ <span className="muted">{openSource(o)}</span>
            </span>
          </label>
        ))}
        {openExtra.map((s) => (
          <label key={s}>
            <input type="checkbox" checked={openChecked.has(s)} onChange={() => toggleOpen(s)} />
            <span>
              {s} <span className="muted">link only</span>
            </span>
          </label>
        ))}
        <form
          className="share-add"
          onSubmit={(e) => {
            e.preventDefault();
            addOpen();
          }}
        >
          <input
            placeholder="owner/repo@tag:folder, a GitHub folder's URL or an archive's URL"
            aria-label="A folder for the link to open"
            value={openSpecText}
            onChange={(e) => setOpenSpecText(e.target.value)}
          />
          <button type="submit" className="button" disabled={!openSpecText.trim() || adding} title="Add it to the link">
            <FolderInput size={14} /> {adding ? "…" : "Add"}
          </button>
        </form>
        {openError && <p className="error">{openError}</p>}

        <More
          more={
            <p>
              The link adds the checked libraries when it opens, with one <code>?lib=</code> each. A library comes
              from a GitHub repository, through jsDelivr, or from the URL of a .zip or .tar.gz archive. Libraries
              added from disk can only travel as files, with All files.
            </p>
          }
        >
          <h3>Libraries</h3>
        </More>
        {mine.map((l) => (
          <label key={l.folder}>
            <input type="checkbox" checked={checked.has(linkSource(l))} onChange={() => toggle(linkSource(l))} />
            <span>
              {l.folder} <span className="muted">{linkSource(l)}</span>
            </span>
          </label>
        ))}
        {extra.map((s) => (
          <label key={s}>
            <input type="checkbox" checked={checked.has(s)} onChange={() => toggle(s)} />
            <span>
              {s} <span className="muted">link only</span>
            </span>
          </label>
        ))}
        {fromDisk.map((l) => (
          <label key={l.folder} className="muted">
            <input type="checkbox" checked={all} disabled />
            <span>
              {l.folder} <span>from disk, shared with All files</span>
            </span>
          </label>
        ))}
        <form
          className="share-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            placeholder="owner/repo, owner/repo@tag or an archive's URL"
            aria-label="A library for the link"
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
          />
          <button type="submit" className="button" disabled={!spec.trim() || adding} title="Add it to the link">
            <PackagePlus size={14} /> {adding ? "…" : "Add"}
          </button>
        </form>
        <More
          more={
            <>
              <p>
                This applies to the libraries and the folders added here. GitHub allows 60 requests per hour per
                IP address, and a repository without a version costs one per visitor, or one per load for an
                embed. A classroom or a campus behind a single address (NAT)
                can run out, and the library then stops loading for everyone there. With a version in the link,
                only jsDelivr is asked.
              </p>
              <p>
                Pinning also gives everyone exactly the same code, which matters for a course. A commit never
                changes, whereas a branch moves and jsDelivr caches it for hours, and a tag can be moved.
              </p>
            </>
          }
        >
          <label className="muted">
            <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />
            <span>Pin GitHub repositories to their latest commit</span>
          </label>
        </More>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
