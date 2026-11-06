// The sentences of a Rocq document, as offsets [start, end) of the text:
// a command ends at a "." followed by a space (or the end), outside
// comments and strings; bullets (-, +, *, repeated), braces and goal
// selectors ("2: {") are sentences of their own.
export type Sentence = { start: number; end: number };

export function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = -1; // the first character of the sentence, -1 between two
  let i = 0;
  const n = text.length;
  const end = (e: number) => {
    out.push({ start, end: e });
    start = -1;
  };
  while (i < n) {
    const c = text[i];
    if (c === "(" && text[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (text[i] === "(" && text[i + 1] === "*") (depth++, (i += 2));
        else if (text[i] === "*" && text[i + 1] === ")") (depth--, (i += 2));
        else if (text[i] === '"') {
          i = text.indexOf('"', i + 1);
          i = i < 0 ? n : i + 1;
        } else i++;
      }
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (start < 0) {
      start = i;
      // bullets
      if (c === "-" || c === "+" || c === "*") {
        let j = i;
        while (text[j] === c) j++;
        end(j);
        i = j;
        continue;
      }
      if (c === "{" || c === "}") {
        end(i + 1);
        i++;
        continue;
      }
    }
    if (c === '"') {
      // ("" inside a string is a quote)
      let j = i + 1;
      for (;;) {
        j = text.indexOf('"', j);
        if (j < 0 || text[j + 1] !== '"') break;
        j += 2;
      }
      i = j < 0 ? n : j + 1;
      continue;
    }
    if (c === "{" && /^\s*(\d+|\[[\w']+\]|all|!)\s*:\s*$/.test(text.slice(start, i))) {
      end(i + 1);
      i++;
      continue;
    }
    if (c === "." && (i + 1 >= n || /\s/.test(text[i + 1])) && text[i - 1] !== ".") {
      end(i + 1);
      i++;
      continue;
    }
    if (c === "." && text.startsWith("...", i) && (i + 3 >= n || /\s/.test(text[i + 3]))) {
      end(i + 3);
      i += 3;
      continue;
    }
    i++;
  }
  return out;
}

// The sentence that the state at [offset] follows: the one containing it,
// or the last one before it
export function sentenceAt(list: Sentence[], offset: number): Sentence | undefined {
  let found: Sentence | undefined;
  for (const s of list) {
    if (s.start > offset) break;
    found = s;
    if (offset <= s.end) break;
  }
  return found;
}

// Offsets and LSP positions (UTF-16 code units, as JavaScript strings)
export function offsetAt(text: string, p: { line: number; character: number }) {
  let o = 0;
  for (let l = 0; l < p.line; l++) {
    const nl = text.indexOf("\n", o);
    if (nl < 0) return text.length;
    o = nl + 1;
  }
  return Math.min(o + p.character, text.length);
}

export function positionAt(text: string, offset: number) {
  const before = text.slice(0, offset);
  const line = before.split("\n").length - 1;
  return { line, character: offset - (before.lastIndexOf("\n") + 1) };
}
