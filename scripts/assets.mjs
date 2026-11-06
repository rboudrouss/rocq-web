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
// - files.json: the manifest web/rocq-web-fs.js creates the file system
//   from (directories, files with their sizes, environment).
// Run with the switch's environment (scripts/env.sh): ocamlfind.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const build = process.argv[2] ?? "full";
const out = process.argv[3] ?? `out/${build}/web`;
const prefix = process.env.OPAM_SWITCH_PREFIX;
if (!prefix) throw new Error("OPAM_SWITCH_PREFIX: source scripts/env.sh");

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
for (const d of ["coqlib", "plugins", "findlib", "files.json", "packages.json"]) rmSync(join(out, d), { recursive: true, force: true });

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

const sorted = [...dirs].sort();
writeFileSync(
  join(out, "files.json"),
  JSON.stringify({
    dirs: sorted,
    files,
    env: { ROCQLIB: "/coqlib", ROCQ_WEB_PLUGINS: "/plugins", OCAMLFIND_CONF: "/findlib/findlib.conf" },
  }),
);
const total = files.reduce((n, f) => n + f[1], 0);
console.log(`${out}: ${packages.length} packages, ${files.length} files, ${(total / 1e6).toFixed(1)} MB (${[...tops].join(" ")})`);
