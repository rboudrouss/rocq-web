// The files that Rocq files read with Extra Dependency, whatever their
// extension (rocq-elpi's .elpi programs, for one). An import keeps them with
// the Rocq files, and they are part of what a compiled file depends on.

// The text without its comments (nested), strings kept
function uncommented(text: string) {
  let out = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("(*", i)) {
      depth++;
      i++;
    } else if (depth > 0 && text.startsWith("*)", i)) {
      depth--;
      i++;
    } else if (depth === 0 && text[i] === '"') {
      const end = text.indexOf('"', i + 1);
      const to = end < 0 ? text.length : end + 1;
      out += text.slice(i, to);
      i = to - 1;
    } else if (depth === 0) out += text[i];
  }
  return out;
}

// The files a Rocq file names in Extra Dependency "FILE", FILE relative to
// the folder of the From prefix
export function extraDependencies(text: string): string[] {
  const names = new Set<string>();
  for (const [, file] of uncommented(text).matchAll(/\bExtra\s+Dependency\s+"([^"]+)"/g))
    names.add(file.replace(/^\.\//, ""));
  return [...names];
}

// Whether [path] is one of the files [names] name (its path ends with one:
// the folder of a From prefix is not known here)
export const named = (path: string, names: Iterable<string>) => {
  for (const n of names) if (path === n || path.endsWith(`/${n}`)) return true;
  return false;
};

// Text that can be kept as a file of the workspace (not a binary file)
export const isText = (text: string) => !text.includes("\u0000");

// Of the files of an import, those to keep: the Rocq files and project
// files, and the text files that one of those Rocq files names. [read]
// gives a file's text (read only for the files that may be kept).
export async function keptFiles<F extends { path: string }>(
  files: F[],
  read: (f: F) => Promise<string>,
  always: (f: F) => boolean = () => false,
): Promise<{ file: F; text: string }[]> {
  const rocq = (p: string) => p.endsWith(".v") || /(^|\/)_(Rocq|Coq)Project$/.test(p);
  const out: { file: F; text: string }[] = [];
  for (const f of files) if (rocq(f.path)) out.push({ file: f, text: await read(f) });
  const names = new Set(out.filter(({ file }) => file.path.endsWith(".v")).flatMap(({ text }) => extraDependencies(text)));
  for (const f of files)
    if (!rocq(f.path) && (always(f) || named(f.path, names))) {
      const text = await read(f);
      if (isText(text)) out.push({ file: f, text });
    }
  return out;
}
