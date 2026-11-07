// Rocq's documents laid out for a width as Format does: boxes whose breaks
// become newlines when what follows does not fit, tags as classes.
import type { ReactNode } from "react";
import { type Text, words } from "../../lib/pp";

type Item =
  | { k: "text"; s: string; tags: string[]; word: number }
  | { k: "break"; n: number; off: number; box: Box }
  | { k: "newline"; box: Box }
  | { k: "open"; box: Box }
  | { k: "close"; box: Box };
type Box = { kind: string; indent: number; col: number; broken: boolean; size: number };

// The document as a sequence of items, with the size of each box on one line
function items(p: Text): Item[] {
  const out: Item[] = [];
  let word = 0;
  const go = (p: Text, tags: string[], box: Box) => {
    const text = (s: string) => {
      for (const w of words(s)) out.push({ k: "text", s: w, tags, word: word++ });
    };
    if (typeof p === "string") return text(p);
    switch (p[0]) {
      case "Pp_string":
        return text(p[1]);
      case "Pp_sized_string":
        return text(p[2]);
      case "Pp_glue":
        return p[1].forEach((q) => go(q, tags, box));
      case "Pp_tag":
        return go(p[2], [...tags, p[1]], box);
      case "Pp_box": {
        const b: Box = { kind: p[1][0], indent: p[1][1] ?? 0, col: 0, broken: false, size: 0 };
        out.push({ k: "open", box: b });
        go(p[2], tags, b);
        out.push({ k: "close", box: b });
        return;
      }
      case "Pp_print_break":
        return void out.push({ k: "break", n: p[1], off: p[2], box });
      case "Pp_force_newline":
        return void out.push({ k: "newline", box });
    }
  };
  go(p, [], { kind: "Pp_vbox", indent: 0, col: 0, broken: true, size: 0 });
  // the length of each box on one line (from the end: the length up to
  // its close, minus that after)
  const stack: number[] = [];
  let total = 0;
  for (let i = out.length - 1; i >= 0; i--) {
    const it = out[i];
    if (it.k === "text") total += it.s.length;
    else if (it.k === "break") total += it.n;
    else if (it.k === "newline") total += 1e6;
    else if (it.k === "close") stack.push(total);
    else if (it.k === "open") it.box.size = total - stack.pop()!;
  }
  return out;
}

// The length from item [i] to the next break or close of [box]
function segment(its: Item[], i: number, box: Box) {
  let n = 0;
  for (let j = i; j < its.length; j++) {
    const it = its[j];
    if ((it.k === "break" || it.k === "newline") && it.box === box) break;
    if (it.k === "close" && it.box === box) break;
    if (it.k === "text") n += it.s.length;
    else if (it.k === "break") n += it.n;
  }
  return n;
}

// The document laid out in [width] columns from column [start]: React
// nodes in a <pre>, its tags as classes (pp-constr-variable...), the words
// of [highlight] marked (diff-added)
export function layout(p: Text, width: number, highlight?: Set<number>, start = 0): ReactNode[] {
  const its = items(p);
  const out: ReactNode[] = [];
  let col = start;
  let key = 0;
  const newline = (indent: number) => {
    out.push("\n" + " ".repeat(Math.max(0, indent)));
    col = Math.max(0, indent);
  };
  for (let i = 0; i < its.length; i++) {
    const it = its[i];
    switch (it.k) {
      case "open":
        it.box.col = col;
        // an hv box is broken (all its breaks) when it does not fit
        it.box.broken = it.box.kind === "Pp_vbox" || (it.box.kind === "Pp_hvbox" && col + it.box.size > width);
        break;
      case "close":
        break;
      case "text": {
        const cls = it.tags.map((t) => "pp-" + t.replace(/\./g, "-")).join(" ");
        const mark = highlight?.has(it.word);
        out.push(cls || mark ? <span key={key++} className={(mark ? "diff-added " : "") + cls}>{it.s}</span> : it.s);
        col += it.s.length;
        break;
      }
      case "newline":
        newline(it.box.col + it.box.indent);
        break;
      case "break": {
        const b = it.box;
        const fits = col + it.n + segment(its, i + 1, b) <= width;
        const breaks =
          b.kind === "Pp_hbox" ? false : b.kind === "Pp_vbox" || b.kind === "Pp_hvbox" ? b.broken : !fits;
        if (breaks) newline(b.col + b.indent + it.off);
        else {
          out.push(" ".repeat(it.n));
          col += it.n;
        }
        break;
      }
    }
  }
  return out;
}

export function PpView({ text, width, highlight, start }: { text: Text; width: number; highlight?: Set<number>; start?: number }) {
  return <>{layout(text, width, highlight, start)}</>;
}
