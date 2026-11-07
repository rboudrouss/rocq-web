// Going to a definition (F12, Ctrl+click), in a file of the workspace or in
// the libraries' sources, and the files shown read only instead of the
// editor: a library's source, a file Rocq wrote (Extraction...).
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { EditorHandle } from "../components/editor/Editor";
import type { Package } from "../components/panels/PackagesPanel";
import type { Position, Range } from "../lib/lsp";
import { isRocq } from "../lib/storage";
import { moduleName, workerUri } from "../lib/workspaces";
import type { Document } from "./useDocument";
import type { Session } from "./useRocqSession";
import type { Workspace } from "./useWorkspace";

// A file shown read only
export type ReadOnlyFile = { uri: string; path: string; text: string; range: Range; note?: string };

const declaration = (name: string) =>
  new RegExp(
    `(^|\\s)((Program\\s+)?(Definition|Lemma|Theorem|Fact|Remark|Corollary|Proposition|Example|Fixpoint|CoFixpoint|Inductive|CoInductive|Variant|Record|Structure|Class|Instance|Let|Axiom|Parameter|Conjecture|Hypothesis|Variable|Ltac2?|Notation|Module)\\s+|\\|\\s*)${name.replace(/[.'\\]/g, "\\$&")}\\b`,
  );

// Where [name] is in [text]: on the range's line when coq-lsp gives one
// (it gives the start of the file for some names: a module's), else at its
// declaration
function find(text: string, range: Range | null, name?: string): Range {
  if (range && range.start.line > 0 && name) {
    const l = text.split("\n")[range.start.line] ?? "";
    const c = l.search(new RegExp(`(^|[^\\w'.])${name.replace(/[.'\\]/g, "\\$&")}(?![\\w'])`));
    if (c >= 0) {
      const character = c + (l[c] === name[0] ? 0 : 1);
      return { start: { line: range.start.line, character }, end: { line: range.start.line, character: character + name.length } };
    }
  }
  if (range && (range.start.line > 0 || range.start.character > 0 || !name)) return range;
  const i = name ? text.search(declaration(name)) : -1;
  const at = i < 0 ? 0 : i + text.slice(i).indexOf(name!);
  const before = text.slice(0, at).split("\n");
  const start = { line: before.length - 1, character: before[before.length - 1].length };
  return { start, end: { line: start.line, character: start.character + (i < 0 ? 0 : name!.length) } };
}

export function useNavigation({
  session,
  ws,
  doc,
  editor,
  packages,
  log,
}: {
  session: Session;
  ws: Workspace;
  doc: Document;
  editor: RefObject<EditorHandle | null>;
  packages: Package[] | null;
  log: (m: string) => void;
}) {
  const [readOnly, setReadOnly] = useState<ReadOnlyFile | null>(null);
  // where the editor of a file opened to go to a definition starts
  const pendingGoTo = useRef<Range | null>(null);
  const { client, ready, assets } = session;
  // (read by the render of the file's editor, once)
  useEffect(() => {
    pendingGoTo.current = null;
  }, [ws.active]);

  const goTo = useCallback(
    (r: Range) => {
      setReadOnly(null);
      editor.current?.goTo(r);
    },
    [editor],
  );

  // The file of a module (Stdlib.Arith.PeanoNat, Workspace.A): a file of
  // the workspace, or a library's source
  const moduleFile = useCallback(
    (full: string): { file?: string; path?: string } | null => {
      const parts = full.split(".");
      const { files, workspaces } = ws.current.current;
      // (the longest module of the workspace the name starts with)
      const mine = files
        .map((f) => [moduleName(f, workspaces, files, ws.read), f] as const)
        .filter(([m]) => m && (full === m || full.startsWith(m + ".")))
        .sort((a, b) => b[0]!.length - a[0]!.length);
      if (mine.length) return { file: mine[0][1] };
      const modules = new Set((packages ?? []).flatMap((p) => p.modules));
      for (let n = parts.length; n > 0; n--) {
        const m = parts.slice(0, n).join(".");
        if (modules.has(m))
          return {
            path: m.startsWith("Corelib.")
              ? `coqlib/theories/${parts.slice(1, n).join("/")}.v`
              : `coqlib/user-contrib/${parts.slice(0, n).join("/")}.v`,
          };
      }
      return null;
    },
    [packages, ws],
  );

  const showLocation = useCallback(
    async (target: { file?: string; path?: string; uri?: string }, range: Range | null, name?: string) => {
      if (target.file) {
        const r = find(ws.read(target.file), range, name);
        if (target.file === ws.current.current.active) goTo(r);
        else {
          // the editor of the file is created there
          pendingGoTo.current = r;
          setReadOnly(null);
          ws.select(target.file);
        }
        return;
      }
      const path = target.path!;
      const res = await fetch(assets + path);
      if (!res.ok) return log(`cannot download ${path} (HTTP ${res.status})`);
      const text = await res.text();
      setReadOnly({
        uri: target.uri ?? `file:///${path}`,
        path: path.replace(/^coqlib\/(user-contrib|theories)\//, ""),
        text,
        range: find(text, range, name),
      });
    },
    [assets, goTo, log, ws],
  );

  const definition = useCallback(
    async (p: Position) => {
      const c = client.current;
      const active = ws.current.current.active;
      if (!ready.current || !c || !isRocq(active)) return;
      const uri = workerUri(active);
      const line = ws.read(active).split("\n")[p.line] ?? "";
      let a = p.character;
      let b = p.character;
      while (a > 0 && /[\w.']/.test(line[a - 1])) a--;
      while (b < line.length && /[\w']/.test(line[b])) b++;
      const qualid = line.slice(a, b).replace(/^\.+|\.+$/g, "");
      const short = qualid.split(".").pop();
      const r = await c.definition(uri, p).catch(() => null);
      const loc = Array.isArray(r) ? r[0] : r;
      const mine = loc && /^file:\/\/\/workspace\/(.+\.v)$/.exec(loc.uri);
      if (mine) return showLocation({ file: mine[1] }, loc.range, short);
      if (loc) return showLocation({ uri: loc.uri, path: loc.uri.replace(/^file:\/\/\//, "") }, loc.range, short);
      // coq-lsp finds neither the definitions of the workspace's files (no
      // .glob) nor those in a module (Nat.add_comm): Locate's full name
      // gives the file, the declaration is searched in it
      if (!qualid) return;
      const located = await c.run(uri, doc.version.current, p, `Locate ${qualid}.`).catch(() => null);
      const first = located?.feedback.map(([, m]) => m).join("\n") ?? "";
      const full = /^\s*(?:Constant|Inductive|Constructor|Ltac2?|Module(?: Type)?|Notation|Abbreviation)\s+([\w.']+)/m.exec(first)?.[1];
      const target = full && moduleFile(full);
      if (!target) return log(`no definition found for ${qualid}`);
      await showLocation(target, null, full!.split(".").pop());
    },
    [client, ready, ws, doc.version, showLocation, moduleFile, log],
  );

  // A file Rocq wrote in the workspace
  const viewProduced = useCallback(
    async (path: string) => {
      const data = await client.current?.readFile(`/workspace/${path}`).catch(() => null);
      if (!data) return log(`cannot read ${path}`);
      const zero = { line: 0, character: 0 };
      setReadOnly({
        uri: `produced:${path}:${data.length}`,
        path,
        text: new TextDecoder().decode(data),
        range: { start: zero, end: zero },
        note: "written by Rocq, read only",
      });
    },
    [client, log],
  );

  return { readOnly, closeReadOnly: () => setReadOnly(null), pendingGoTo, goTo, showLocation, definition, viewProduced };
}
