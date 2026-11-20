// The Share button's dialog: the link, made again and copied at each
// change of what it shares: the current file or all of them, the user's
// libraries that can be fetched again (?lib=SPEC), others added for the
// link only (a GitHub repository pinned to its last commit by default). A
// warning when the link is too long.
import { Copy, PackagePlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fetchable, type Libraries, linkSource } from "../../hooks/useLibraries";
import type { Workspace } from "../../hooks/useWorkspace";
import { gitHubRepository, isCommit, latestCommit } from "../../lib/library";
import { longUrl, maxUrl, type Shared, shareUrl, workspacesOf } from "../../lib/share";

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

export function ShareDialog({ start, ws, libs, log, close }: Props) {
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
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  const mine = libs.libraries.filter((l) => fetchable(l.source));
  const fromDisk = libs.libraries.filter((l) => !fetchable(l.source));
  // (all the files: those of the libraries that a link can fetch left out)
  const allFiles = ws.files.filter((f) => !mine.some((l) => f.startsWith(`${l.folder}/`)));
  const sources = [...mine.map(linkSource), ...extra].filter((s) => checked.has(s));

  const shared = (): Shared => {
    const paths = all ? allFiles : file ? [ws.active] : [];
    return {
      active: paths.includes(ws.active) ? ws.active : null,
      files: paths.map((p) => [p, ws.read(p)]),
      workspaces: workspacesOf(paths, ws.workspaces),
    };
  };

  // The link made again and copied
  const key = JSON.stringify([file, all, sources]);
  useEffect(() => {
    let current = true;
    const s = shared();
    shareUrl(s, sources).then(async (u) => {
      if (!current) return;
      setUrl(u);
      const ok = await navigator.clipboard?.writeText(u).then(
        () => true,
        () => false,
      );
      if (!current) return;
      setCopied(!!ok);
      log(`link${s.files.length ? ` to ${plural(s.files.length, "file")}` : ""}${sources.length ? ` with ${plural(sources.length, "library")}` : ""} ${ok ? "copied" : "made"} (${u.length} characters)`);
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
    if (!gh && !fetchable(s)) return setError(`${s}: not a GitHub repository (owner/repo[@ref]) nor an archive's URL`);
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

  const copy = async () => {
    const ok = await navigator.clipboard?.writeText(url).then(
      () => true,
      () => false,
    );
    setCopied(!!ok);
    if (!ok) field.current?.select();
  };

  const files = all ? allFiles.length : file ? 1 : 0;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog share-dialog" role="dialog" aria-label="Share a link">
        <div className="dialog-title">
          <h2>Share a link</h2>
          <button className="icon" onClick={close} aria-label="Close" title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="share-link">
          <input ref={field} readOnly value={url} aria-label="The link" onFocus={(e) => e.target.select()} />
          <button className="button" onClick={copy} title="Copy the link">
            <Copy size={14} /> Copy
          </button>
        </div>
        <p className="muted share-status">
          {url.length.toLocaleString()} characters
          {copied ? ", copied to the clipboard" : ""}
          {!files && !sources.length ? ": the page alone" : ""}
        </p>
        {url.length > maxUrl ? (
          <p className="share-warning error">
            Too long: Chrome and Edge do not open links of more than 2 MB. Share fewer files.
          </p>
        ) : (
          url.length > longUrl && (
            <p className="share-warning">
              A long link: chats, mail and some sites may cut it. Share fewer files, or the files as an archive.
            </p>
          )
        )}

        <h3>Files</h3>
        <label>
          <input type="checkbox" checked={file || all} disabled={all} onChange={(e) => setFile(e.target.checked)} />
          The current file <span className="muted">{ws.active}</span>
        </label>
        <label>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          All the files <span className="muted">{plural(allFiles.length, "file")}</span>
        </label>

        <h3>Libraries</h3>
        {mine.map((l) => (
          <label key={l.folder}>
            <input type="checkbox" checked={checked.has(linkSource(l))} onChange={() => toggle(linkSource(l))} />
            {l.folder} <span className="muted">{linkSource(l)}</span>
          </label>
        ))}
        {extra.map((s) => (
          <label key={s}>
            <input type="checkbox" checked={checked.has(s)} onChange={() => toggle(s)} />
            {s} <span className="muted">for the link only</span>
          </label>
        ))}
        {fromDisk.map((l) => (
          <label key={l.folder} className="muted" title="Added from disk: its files are in the link with all the files">
            <input type="checkbox" checked={all} disabled />
            {l.folder} <span>from disk, with all the files</span>
          </label>
        ))}
        {!mine.length && !extra.length && !fromDisk.length && <p className="muted">No libraries added.</p>}
        <form
          className="share-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            placeholder="owner/repo, owner/repo@tag, or an archive's URL"
            aria-label="A library for the link"
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
          />
          <button type="submit" className="button" disabled={!spec.trim() || adding} title="Add it to the link">
            <PackagePlus size={14} /> {adding ? "…" : "Add"}
          </button>
        </form>
        <label className="muted">
          <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />
          GitHub repositories at their last commit
        </label>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
