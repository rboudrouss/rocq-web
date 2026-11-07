// Rocq's pretty-printing documents (Pp.t, as coq-lsp's pp_format "Pp"
// gives them): their text, their words, and those one adds to another
// (their layout: components/goals/Pp.tsx).

export type Pp =
  | ["Pp_empty"]
  | ["Pp_string", string]
  | ["Pp_sized_string", number, string]
  | ["Pp_glue", Pp[]]
  | ["Pp_box", [string, number?], Pp]
  | ["Pp_tag", string, Pp]
  | ["Pp_print_break", number, number]
  | ["Pp_force_newline"]
  | ["Pp_comment", string[]];

// A text, or a document
export type Text = string | Pp;

// The words of a string, and its spaces
export const words = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];

// The text on one line
export function flat(p: Text): string {
  if (typeof p === "string") return p;
  switch (p[0]) {
    case "Pp_string":
      return p[1];
    case "Pp_sized_string":
      return p[2];
    case "Pp_glue":
      return p[1].map(flat).join("");
    case "Pp_box":
      return flat(p[2]);
    case "Pp_tag":
      return flat(p[2]);
    case "Pp_print_break":
      return " ".repeat(p[1]);
    case "Pp_force_newline":
      return "\n";
    default:
      return "";
  }
}

// The words of a text, in the order [layout] numbers them
export function tokens(p: Text): string[] {
  const out: string[] = [];
  const go = (p: Text) => {
    if (typeof p === "string") return void out.push(...words(p));
    switch (p[0]) {
      case "Pp_string":
        return void out.push(...words(p[1]));
      case "Pp_sized_string":
        return void out.push(...words(p[2]));
      case "Pp_glue":
        return p[1].forEach(go);
      case "Pp_box":
      case "Pp_tag":
        return go(p[2]);
    }
  };
  go(p);
  return out;
}

// The indices of the words of [now] which are not in [before] (a longest
// common subsequence of their words, not counting spaces)
export function added(before: Text | undefined, now: Text): Set<number> {
  const b = before === undefined ? [] : tokens(before);
  const a = tokens(now);
  const out = new Set<number>();
  const isWord = (w: string) => !/^\s+$/.test(w);
  if (before === undefined) return out;
  const ai = a.map((w, i) => [w, i] as const).filter(([w]) => isWord(w));
  const bw = b.filter(isWord);
  const n = ai.length;
  const m = bw.length;
  if (n * m > 4_000_000) return out;
  // lengths of the common subsequences of the suffixes
  const t = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      t[i][j] = ai[i][0] === bw[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  let i = 0;
  let j = 0;
  while (i < n) {
    if (j < m && ai[i][0] === bw[j]) {
      i++;
      j++;
    } else if (j < m && t[i][j + 1] >= t[i + 1][j]) j++;
    else out.add(ai[i++][1]);
  }
  return out;
}
