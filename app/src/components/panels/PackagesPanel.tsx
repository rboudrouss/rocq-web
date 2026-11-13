// Packages: the libraries the user added (hooks/useLibraries.ts: from
// GitHub, an archive or a folder, each a workspace of its own), a form to add one,
// and the build's packages (scripts/assets.mjs's packages.json)
import { FolderInput, FolderOpen, PackagePlus, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Libraries } from "../../hooks/useLibraries";

export type Package = {
  name: string;
  version: string;
  synopsis: string;
  homepage?: string;
  depends: string[];
  modules: string[];
};

export const requireLine = (module: string) => {
  const [root, ...rest] = module.split(".");
  return rest.length ? `From ${root} Require Import ${rest.join(".")}.` : `Require Import ${root}.`;
};

type Props = {
  packages: Package[] | null;
  libs: Libraries;
  insert: (line: string) => void;
  // (the folder of a library shown in the Files panel)
  showFolder: (folder: string) => void;
  // (changes when the form should take the focus: the Files panel's button)
  focusAdd: number;
};

// Those matching a filter: [entry, its modules shown, open] (keepEmpty:
// those without modules too, when nothing is searched)
function filtered<T extends { modules: string[] }>(list: T[], f: string, text: (x: T) => string, keepEmpty = false) {
  return list
    .map((p) => {
      const own = !f || text(p).toLowerCase().includes(f);
      const modules = own ? p.modules : p.modules.filter((m) => m.toLowerCase().includes(f));
      return { p, modules, open: !!f && !own };
    })
    .filter((x) => x.modules.length > 0 || (keepEmpty && !f));
}

function Modules({ modules, insert }: { modules: string[]; insert: (line: string) => void }) {
  return (
    <ul className="modules">
      {modules.slice(0, 300).map((m) => (
        <li key={m}>
          <button title={requireLine(m)} onClick={() => insert(requireLine(m))}>
            {m}
          </button>
        </li>
      ))}
      {modules.length > 300 && <li className="muted">{modules.length - 300} more, refine the search</li>}
    </ul>
  );
}

export function PackagesPanel({ packages, libs, insert, showFolder, focusAdd }: Props) {
  const [filter, setFilter] = useState("");
  const [spec, setSpec] = useState("");
  const specInput = useRef<HTMLInputElement>(null);
  const archiveInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  useEffect(() => folderInput.current?.setAttribute("webkitdirectory", ""), []);
  useEffect(() => {
    if (focusAdd) specInput.current?.focus();
  }, [focusAdd]);

  const f = filter.toLowerCase();
  const shown = useMemo(() => filtered(packages ?? [], f, (p) => `${p.name} ${p.synopsis}`), [packages, f]);
  const added = filtered(libs.libraries, f, (l) => `${l.folder} ${l.source}`, true);

  const submit = () => {
    const s = spec.trim();
    if (!s || libs.progress) return;
    libs.fromSpec(s).then((ok) => ok && setSpec(""));
  };

  return (
    <div className="packages">
      <section className="add-library">
        <h3>Add a library</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            ref={specInput}
            placeholder="owner/repo, owner/repo@tag, or an archive's URL"
            aria-label="A GitHub repository or an archive's URL"
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
          />
          <button type="submit" className="button" disabled={!spec.trim() || libs.progress !== null} title="Add it">
            <PackagePlus size={14} /> Add
          </button>
        </form>
        <div className="from-disk">
          <span className="muted">or from disk:</span>
          <button className="link" disabled={libs.progress !== null} onClick={() => archiveInput.current?.click()}>
            <Upload size={12} /> an archive (.zip, .tar.gz)
          </button>
          <button className="link" disabled={libs.progress !== null} onClick={() => folderInput.current?.click()}>
            <FolderInput size={12} /> a folder
          </button>
        </div>
        {libs.progress && <p className="muted progress">{libs.progress}…</p>}
        {libs.error && <p className="error">{libs.error}</p>}
        <p className="muted">
          Rocq files from GitHub, an archive or a folder, added to your files as a workspace of their own. Their OCaml
          plugins cannot be built in the browser yet.
        </p>
        <input
          ref={archiveInput}
          type="file"
          accept=".zip,.tar,.tar.gz,.tgz"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) libs.fromArchive(file);
            e.target.value = "";
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) libs.fromFolder(e.target.files);
            e.target.value = "";
          }}
        />
      </section>

      <input placeholder="Search packages and modules" value={filter} onChange={(e) => setFilter(e.target.value)} />

      {added.length > 0 && (
        <>
          <h3>Your libraries</h3>
          {added.map(({ p: l, modules, open }) => (
            <details key={l.folder} className="library-entry" open={open || undefined}>
              <summary>
                <b>{l.folder}</b>
                <div className="synopsis">{l.source}</div>
              </summary>
              <div className="library-actions">
                <button className="link" onClick={() => showFolder(l.folder)} title={`Show ${l.folder}/ in the files`}>
                  <FolderOpen size={12} /> Show its files
                </button>
                <button className="link danger" onClick={() => libs.remove(l.folder)} title={`Delete ${l.folder}/`}>
                  <Trash2 size={12} /> Remove
                </button>
              </div>
              {modules.length ? (
                <Modules modules={modules} insert={insert} />
              ) : (
                <p className="muted">No module: its project file names none of its files.</p>
              )}
            </details>
          ))}
          <h3>The build's packages</h3>
        </>
      )}

      {!packages ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <p className="muted">
            {packages.length} packages. Click a module to insert its <code>Require</code>. Its files are downloaded when
            Rocq loads it.
          </p>
          {shown.map(({ p, modules, open }) => (
            <details key={p.name} open={open || undefined}>
              <summary>
                <b>{p.name}</b> <span className="muted">{p.version}</span>
                <div className="synopsis">{p.synopsis}</div>
              </summary>
              {p.homepage && (
                <a href={p.homepage} target="_blank" rel="noreferrer">
                  {p.homepage}
                </a>
              )}
              {p.depends.length > 0 && <div className="muted">needs {p.depends.join(", ")}</div>}
              <Modules modules={modules} insert={insert} />
            </details>
          ))}
        </>
      )}
    </div>
  );
}
