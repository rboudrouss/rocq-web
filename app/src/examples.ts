// The examples of public/examples (index.json): files written to the
// workspace in a folder named after them, from the menu or a link
// (?example=ID).
import { listFiles, readFile, writeFile } from "./files";

export type Example = { id: string; title: string; description: string; files: string[] };

const base = `${import.meta.env.BASE_URL}examples/`;

export async function examples(): Promise<Example[]> {
  const r = await fetch(`${base}index.json`);
  return r.ok ? r.json() : [];
}

// Writes an example's files in DIR/ (ID/, or ID_2/... when ID/ has other
// texts in it, unless [replace]): their paths
export async function loadExample(e: Example, replace = false): Promise<string[]> {
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
  for (let i = 2; !replace && differs(dir); i++) dir = `${e.id}_${i}`;
  for (const [f, t] of texts) writeFile(`${dir}/${f}`, t);
  return texts.map(([f]) => `${dir}/${f}`);
}

