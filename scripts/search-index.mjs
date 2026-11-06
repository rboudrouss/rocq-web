// The declarations of the libraries' sources (coqlib/**/*.v), for the
// app's search of the libraries: lines of tab-separated fields,
//   @MODULE  PATH                    a file (Stdlib.Arith.PeanoNat, its .v)
//   KIND  NAME  LINE  STATEMENT      a declaration in it (LINE from 1, its
//                                    statement up to := or its end, on
//                                    one line, at most 300 characters)
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const kinds =
  "Lemma|Theorem|Definition|Fixpoint|CoFixpoint|Inductive|CoInductive|Variant|Record|Structure|Class|Instance|Corollary|Proposition|Fact|Remark|Axiom|Axioms|Parameter|Parameters|Conjecture|Notation|Ltac|Ltac2|Example|Let|Canonical|Coercion|Program Definition|Program Fixpoint|Program Lemma|Equations";
const declaration = new RegExp(
  String.raw`^[ \t]*(?:#\[[^\]]*\][ \t]*)?(?:(?:Local|Global|Polymorphic|Monomorphic|Private|Program)[ \t]+)*(${kinds})[ \t]+(?:Structure[ \t]+|Instance[ \t]+)?("[^"]*"|[\w'.]+)`,
  "gm",
);

// The text with its comments blanked (their newlines kept), strings kept
function blank(text) {
  let out = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" && text[i + 1] === "*") {
      depth++;
      out += "  ";
      i++;
    } else if (depth > 0 && c === "*" && text[i + 1] === ")") {
      depth--;
      out += "  ";
      i++;
    } else if (depth > 0) out += c === "\n" ? "\n" : " ";
    else if (c === '"') {
      const end = text.indexOf('"', i + 1);
      const j = end < 0 ? text.length - 1 : end;
      out += text.slice(i, j + 1);
      i = j;
    } else out += c;
  }
  return out;
}

// The statement after a declaration's name: up to := or the end of its
// sentence
function statement(code, from) {
  const end = /:=|\.(?=\s|$)/g;
  end.lastIndex = from;
  const m = end.exec(code);
  const s = code.slice(from, m ? m.index : from + 400).replace(/\s+/g, " ").trim();
  return s.length > 300 ? s.slice(0, 299) + "…" : s;
}

export function searchIndex(coqlib) {
  const lines = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".v")) file(p);
    }
  };
  const file = (p) => {
    const rel = relative(coqlib, p);
    const [sub, ...rest] = rel.split("/");
    const module = (sub === "theories" ? ["Corelib", ...rest] : rest).join(".").replace(/\.v$/, "");
    const code = blank(readFileSync(p, "utf8"));
    const found = [];
    let line = 1;
    let at = 0;
    for (const m of code.matchAll(declaration)) {
      for (; at < m.index; at++) if (code[at] === "\n") line++;
      const kind = m[1].replace(/^Program /, "");
      found.push([kind, m[2], line, statement(code, m.index + m[0].length)].join("\t"));
    }
    if (found.length) lines.push(`@${module}\tcoqlib/${rel}`, ...found);
  };
  walk(join(coqlib, "theories"));
  walk(join(coqlib, "user-contrib"));
  return lines.join("\n") + "\n";
}
