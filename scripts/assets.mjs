// The files of the web worker, into OUT (default out/full/web):
//   node scripts/assets.mjs [BUILD] [OUT]
// - coqlib/: Rocq's libraries from the switch (lib/coq): Corelib and those
//   of user-contrib (.vo, .glob, .v, .elpi);
// - plugins/: the build's plugins (out/BUILD/plugins/*.wasm);
// - findlib/: findlib.conf and the META files of the packages the plugins
//   need, as findlib resolves plugins' dependencies;
// - packages.json: the opam packages of these libraries (name, version,
//   synopsis, homepage, the packages it depends on, its modules), for the
//   app's package browser;
// - search.tsv: the declarations of the libraries' sources, for the app's
//   search (scripts/search-index.mjs);
// - boot.bin: findlib's files (it reads them all when it starts) and those
//   listed in web/boot-files.txt (those Rocq reads when it starts, written
//   by tests/startup.mjs --record), in one request;
// - files.json: the manifest web/rocq-web-fs.js creates the file system
//   from (directories, files with their sizes, what each needs,
//   environment, the version of the files).
// Run by make (Makefile), in the switch's environment: ocamlfind.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { searchIndex } from "./search-index.mjs";

const build = process.argv[2] ?? "full";
const out = process.argv[3] ?? `out/${build}/web`;
const prefix = process.env.OPAM_SWITCH_PREFIX;
if (!prefix) throw new Error("OPAM_SWITCH_PREFIX: run it by make (make full), or eval \"$(make -s env)\" first");

const ocamlfind = (...args) => execFileSync("ocamlfind", args, { encoding: "utf8" }).trim();

const files = [];
const dirs = new Set();
// copies SRC to OUT/DEST, recorded as /DEST
function add(src, dest) {
  const to = join(out, dest);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(src, to);
  files.push(["/" + dest, statSync(src).size]);
  dirs.add("/" + dirname(dest));
}
function walk(dir, f) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, f);
    else f(p);
  }
}

// (the worker itself, lsp_worker.js and .wasm, is built in OUT too)
for (const d of ["coqlib", "plugins", "findlib", "files.json", "packages.json", "search.tsv", "boot.bin"]) rmSync(join(out, d), { recursive: true, force: true });

// Rocq's libraries: Corelib (theories) and every library installed in
// user-contrib (Ltac2, Stdlib, mathcomp...), with their sources and
// globalization files (go to definition), and elpi's programs
const coqlib = join(prefix, "lib/coq");
for (const sub of ["theories", "user-contrib"])
  walk(join(coqlib, sub), (p) => {
    if (/\.(vo|glob|v|elpi)$/.test(p)) add(p, join("coqlib", relative(coqlib, p)));
  });

// The plugins
const plugins = readdirSync(`out/${build}/plugins`).filter((f) => f.endsWith(".wasm"));
for (const f of plugins) add(join(`out/${build}/plugins`, f), join("plugins", f));

// findlib: the packages of the plugins and those they require
const pkgs = plugins.map((f) => f.replace(/\.wasm$/, ""));
const needed = new Set(ocamlfind("query", "-r", "-format", "%p", ...pkgs).split("\n"));
const tops = new Set([...needed].map((p) => p.split(".")[0]));
for (const top of tops) {
  const dir = ocamlfind("query", "-format", "%d", top);
  const meta = [join(dir, "META"), join(prefix, "lib", top, "META"), join(prefix, "lib/ocaml", top, "META")].find(
    existsSync,
  );
  if (!meta) throw new Error(`no META for ${top}`);
  add(meta, join("findlib", top, "META"));
}
const conf = join(out, "findlib/findlib.conf");
writeFileSync(conf, 'destdir="/findlib"\npath="/findlib"\n');
files.push(["/findlib/findlib.conf", statSync(conf).size]);

// The opam packages with Rocq libraries, from the switch's metadata
const opamDir = join(prefix, ".opam-switch");
const opamString = (opam, field) =>
  new RegExp(`^${field}:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "m").exec(opam)?.[1].replace(/\\(.)/g, "$1");
const packages = [];
for (const dir of readdirSync(join(opamDir, "packages"))) {
  const [, name, version] = /^(.+?)\.([^.]*\d.*)$/.exec(dir) ?? [];
  const changes = join(opamDir, "install", `${name}.changes`);
  if (!name || !existsSync(changes)) continue;
  const modules = [...readFileSync(changes, "utf8").matchAll(/"lib\/coq\/(theories|user-contrib)\/([^"]+)\.vo"/g)]
    .map(([, sub, path]) => (sub === "theories" ? "Corelib/" : "") + path)
    .map((path) => path.replaceAll("/", "."))
    .sort();
  if (modules.length === 0) continue;
  const opam = readFileSync(join(opamDir, "packages", dir, "opam"), "utf8");
  const depends = /^depends:\s*\[([^\]]*)\]/m.exec(opam)?.[1] ?? "";
  packages.push({
    name,
    version,
    synopsis: opamString(opam, "synopsis") ?? "",
    homepage: opamString(opam, "homepage"),
    depends: [...depends.matchAll(/^\s*"([^"]+)"/gm)].map((m) => m[1]),
    modules,
  });
}
const names = new Set(packages.map((p) => p.name));
for (const p of packages) p.depends = p.depends.filter((d) => names.has(d));
writeFileSync(join(out, "packages.json"), JSON.stringify(packages));
writeFileSync(join(out, "search.tsv"), searchIndex(join(out, "coqlib")));

// What each file needs once read, which the worker then downloads at once
// (web/rocq-web-fs.js): a .vo, the libraries it requires (its summary,
// scripts/vo-deps.ml) and the plugins it declares (their names in it, as
// OCaml marshals a string: its length then its bytes); a plugin, those
// findlib loads before it (worker/plugins/plugins.ml)
const index = new Map(files.map((f, i) => [f[0], i]));
const tool = join(tmpdir(), `rocq-web-vo-deps-${process.pid}`);
mkdirSync(tool, { recursive: true });
cpSync("scripts/vo-deps.ml", join(tool, "vo_deps.ml"));
execFileSync("ocamlfind", ["ocamlopt", "-package", "rocq-runtime.lib", "-linkpkg", "vo_deps.ml", "-o", "vo-deps"], {
  cwd: tool,
});
const vos = files.map((f) => f[0]).filter((p) => p.endsWith(".vo"));
const summaries = execFileSync(join(tool, "vo-deps"), {
  input: vos.map((p) => join(out, p.slice(1))).join("\n") + "\n",
  encoding: "utf8",
  maxBuffer: 1 << 28,
})
  .trim()
  .split("\n")
  .map((l) => l.split(" "));
rmSync(tool, { recursive: true, force: true });
const library = new Map(summaries.map(([file, name]) => [name, "/" + relative(out, file)]));
const pluginIndex = (p) => index.get(`/plugins/${p}.wasm`);
// (as worker/lsp_worker.ml: Rocq's plugins through serlib's)
const serlib = (p) => {
  const m = /^rocq-runtime\.plugins\.(.+)$/.exec(p);
  return m && pluginIndex(`coq-lsp.serlib.${m[1]}`) !== undefined ? `coq-lsp.serlib.${m[1]}` : p;
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const declared = new RegExp([...pkgs].sort((a, b) => b.length - a.length).map(esc).join("|"), "g");
const deps = [];
for (const [file, , ...required] of summaries) {
  const own = required.map((n) => index.get(library.get(n))).filter((i) => i !== undefined);
  const s = readFileSync(file).toString("latin1");
  for (const m of s.matchAll(declared)) {
    const n = m[0].length, at = m.index;
    if (n < 32 ? s.charCodeAt(at - 1) === (0x20 | n) : s.charCodeAt(at - 2) === 9 && s.charCodeAt(at - 1) === n)
      own.push(pluginIndex(serlib(m[0])));
  }
  if (own.length) deps.push([index.get("/" + relative(out, file)), ...new Set(own)]);
}
for (const p of pkgs) {
  const before = ocamlfind("query", "-r", "-format", "%p", p)
    .split("\n")
    .filter((q) => q !== p)
    .map(pluginIndex)
    .filter((i) => i !== undefined);
  if (before.length) deps.push([pluginIndex(p), ...before]);
}

// boot.bin
const bootList = "web/boot-files.txt";
const bootFiles = new Set(existsSync(bootList) ? readFileSync(bootList, "utf8").split("\n").filter(Boolean) : []);
const chunks = [];
let offset = 0;
for (const f of files)
  if (bootFiles.has(f[0]) || f[0].startsWith("/findlib/")) {
    chunks.push(readFileSync(join(out, f[0].slice(1))));
    f.push(offset);
    offset += f[1];
  }
writeFileSync(join(out, "boot.bin"), Buffer.concat(chunks));

// The version of these files, a hash of their contents: in the URLs the
// worker fetches them at (?v=), which a server may then cache for good
const hash = createHash("sha256");
for (const [path] of files) hash.update(path).update(readFileSync(join(out, path.slice(1))));
hash.update(readFileSync(join(out, "boot.bin")));
const version = hash.digest("hex").slice(0, 16);

const sorted = [...dirs].sort();
writeFileSync(
  join(out, "files.json"),
  JSON.stringify({
    dirs: sorted,
    files,
    boot: "boot.bin",
    // [file, what it needs...], by their indices in files
    deps,
    version,
    // OCAMLRUNPARAM: a minor heap of 32 MB (Rocq sets 256 MB unless it is
    // given, which takes 130 ms to clear when it starts, for no faster
    // proofs)
    env: {
      ROCQLIB: "/coqlib",
      ROCQ_WEB_PLUGINS: "/plugins",
      OCAMLFIND_CONF: "/findlib/findlib.conf",
      OCAMLRUNPARAM: "s=4M,o=120",
    },
  }),
);
const total = files.reduce((n, f) => n + f[1], 0);
console.log(`${out}: ${packages.length} packages, ${files.length} files, ${(total / 1e6).toFixed(1)} MB, boot.bin ${chunks.length} files ${(offset / 1e6).toFixed(1)} MB (${[...tops].join(" ")})`);
