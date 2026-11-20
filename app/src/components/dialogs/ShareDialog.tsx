// The Share button's dialog: a link, or the HTML that embeds the page in
// another one, made again and copied at each change of what it shares: the
// current file or all of them, the user's libraries that can be fetched
// again (?lib=SPEC), others for the link only (a GitHub repository pinned
// to its last commit by default). A warning when the link is too long, and
// (i) buttons that tell more.
import { Code, Copy, Info, Link, PackagePlus, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { fetchable, type Libraries, linkSource } from "../../hooks/useLibraries";
import type { Workspace } from "../../hooks/useWorkspace";
import { gitHubRepository, isCommit, latestCommit } from "../../lib/library";
import { embedCode, embedUrl, longUrl, maxUrl, type Shared, shareUrl, workspacesOf } from "../../lib/share";

// What the dialog shares when it opens (file: the current one; libraries:
// their sources, checked)
export type ShareStart = { file: boolean; libraries: string[] };

type Props = {
  start: ShareStart;
  ws: Workspace;
  libs: Libraries;
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

export function ShareDialog({ start, ws, libs, log, close }: Props) {
  const [embed, setEmbed] = useState(false);
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
  // the link (what is copied: it, or the HTML of the embed)
  const [link, setLink] = useState("");
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const mine = libs.libraries.filter((l) => fetchable(l.source));
  const fromDisk = libs.libraries.filter((l) => !fetchable(l.source));
  // (all the files: those of the libraries that a link can fetch left out)
  const allFiles = ws.files.filter((f) => !mine.some((l) => f.startsWith(`${l.folder}/`)));
  const sources = [...mine.map(linkSource), ...extra].filter((s) => checked.has(s));
  const text = embed ? embedCode(embedUrl(link)) : link;

  const shared = (): Shared => {
    const paths = all ? allFiles : file ? [ws.active] : [];
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
  const key = JSON.stringify([file, all, sources, embed]);
  useEffect(() => {
    let current = true;
    const s = shared();
    shareUrl(s, sources, new URL(location.pathname, location.href).href).then(async (u) => {
      if (!current) return;
      setLink(u);
      const ok = await copy(embed ? embedCode(embedUrl(u)) : u);
      if (!current) return;
      const what = [s.files.length && plural(s.files.length, "file"), sources.length && plural(sources.length, "library")];
      log(
        `${embed ? "embed" : "link"}${what.some(Boolean) ? ` with ${what.filter(Boolean).join(" and ")}` : ""} ${ok ? "copied" : "made"} (${u.length} characters)`,
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

  const toggle = (source: string) =>
    setChecked((c) => {
      const n = new Set(c);
      if (n.has(source)) n.delete(source);
      else n.add(source);
      return n;
    });

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
      const source =
        gh && pin && !(gh.ref && isCommit(gh.ref))
          ? `${gh.owner}/${gh.repo}@${await latestCommit(gh.owner, gh.repo, gh.ref ?? "HEAD")}`
          : gh
            ? `${gh.owner}/${gh.repo}${gh.ref ? `@${gh.ref}` : ""}`
            : s;
      if (!mine.some((l) => linkSource(l) === source)) setExtra((e) => (e.includes(source) ? e : [...e, source]));
      setChecked((c) => new Set(c).add(source));
      setSpec("");
    } catch (e) {
      setError((e as Error).message);
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
            <p>
              Opening the link copies the files into the visitor's browser. A file whose path they already use
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
            This file <span className="muted">{ws.active}</span>
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
                GitHub allows 60 requests per hour per IP address, and a repository without a version costs one
                per visitor, or one per load for an embed. A classroom or a campus behind a single address (NAT)
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
