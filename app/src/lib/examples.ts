// The examples of public/examples (index.json): files written in a folder
// named after them, a workspace of its own (its modules ID.*), from the
// menu or a link (?example=ID).
import type { DiskFile } from "./disk";
import { listFiles, listWorkspaces, readFile, setWorkspaces, writeFile } from "./storage";
import { canBeWorkspace } from "./workspaces";

export type Example = { id: string; title: string; description: string; files: string[] };

const base = `${import.meta.env.BASE_URL}examples/`;

export async function examples(): Promise<Example[]> {
  const r = await fetch(`${base}index.json`);
  return r.ok ? r.json() : [];
}

// An example's files in DIR/ (ID/, or ID_2/... when ID/ has other texts in
// it)
export async function exampleFiles(e: Example): Promise<DiskFile[]> {
  const texts = await Promise.all(
    e.files.map(async (f) => {
      const r = await fetch(`${base}${e.id}/${f}`);
      if (!r.ok) throw new Error(`${e.id}/${f}: HTTP ${r.status}`);
      return [f, await r.text()] as const;
    }),
  );
  const mine = new Set(listFiles());
  const differs = (dir: string) => texts.some(([f, t]) => mine.has(`${dir}/${f}`) && readFile(`${dir}/${f}`) !== t);
  let dir = e.id;
  for (let i = 2; differs(dir); i++) dir = `${e.id}_${i}`;
  return texts.map(([f, text]) => ({ path: `${dir}/${f}`, text }));
}

// Writes an example's files (before the page starts: a link), its folder a
// workspace: their paths
export async function loadExample(e: Example): Promise<string[]> {
  const files = await exampleFiles(e);
  for (const { path, text } of files) writeFile(path, text);
  const dir = files[0]?.path.split("/")[0];
  const ws = listWorkspaces();
  if (dir && !ws.includes(dir) && canBeWorkspace(dir, ws)) setWorkspaces([...ws, dir]);
  return files.map((f) => f.path);
}
