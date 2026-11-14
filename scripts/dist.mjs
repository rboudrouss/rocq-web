// The static site, in DIR (default dist/): the app (vite build) and, in
// rocq/BUILD/, the worker and Rocq's files of each build made
// (out/BUILD/web, scripts/build.sh), each file with its brotli
// compression next to it (FILE.br), which scripts/serve.mjs serves:
//   node scripts/dist.mjs [DIR]
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { brotliCompress, constants } from "node:zlib";
import { promisify } from "node:util";

const dir = process.argv[2] ?? "dist";
const compress = promisify(brotliCompress);

rmSync(dir, { recursive: true, force: true });
execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: "app", stdio: "inherit" });
execFileSync("pnpm", ["exec", "tsc", "-b"], { cwd: "app", stdio: "inherit" });
execFileSync("pnpm", ["exec", "vite", "build", "--outDir", join("..", dir), "--emptyOutDir"], {
  cwd: "app",
  stdio: "inherit",
});
// vite copied app/public, whose rocq/BUILD are links to out/BUILD/web in
// development (without ocaml-emcc's work directory, .lsp_worker.ocaml-emcc)
for (const build of ["full", "compat"]) {
  const to = join(dir, "rocq", build);
  rmSync(to, { recursive: true, force: true });
  const from = `out/${build}/web`;
  if (existsSync(join(from, "files.json")))
    cpSync(from, to, { recursive: true, dereference: true, filter: (p) => !basename(p).startsWith(".") });
}

// The libraries of compat, the same .vo as full's (docs/design.md): served
// from full's (a rewrite of _redirects, which scripts/serve.mjs, Netlify
// and Cloudflare Pages follow) when every file is the same
const rewrites = [];
{
  const full = join(dir, "rocq/full/coqlib"), compat = join(dir, "rocq/compat/coqlib");
  if (existsSync(full) && existsSync(compat)) {
    let same = true;
    walk(compat, (p) => {
      const q = join(full, relative(compat, p));
      if (same && (!existsSync(q) || !readFileSync(p).equals(readFileSync(q)))) same = false;
    });
    if (same) {
      rmSync(compat, { recursive: true });
      rewrites.push("/rocq/compat/coqlib/* /rocq/full/coqlib/:splat 200");
    }
  }
}
writeFileSync(join(dir, "_redirects"), rewrites.map((r) => r + "\n").join(""));

// The servers that cannot set headers: COOP and COEP (scripts/serve.mjs
// sets them itself) for Netlify and Cloudflare Pages, and the files cached
// for good: vite's, named by their hash, and Rocq's, fetched with theirs
// (?v=, web/rocq-web-fs.js), else revalidated at each visit, one request
// each
const forGood = "  Cache-Control: public, max-age=31536000, immutable\n";
writeFileSync(
  join(dir, "_headers"),
  "/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n" +
    ["/assets/*", "/rocq/:build/coqlib/*", "/rocq/:build/plugins/*", "/rocq/:build/boot.bin"]
      .map((p) => p + "\n" + forGood)
      .join(""),
);

function walk(d, f) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, f);
    else f(p);
  }
}
const files = [];
walk(dir, (p) => {
  if (/\.(wasm|js|mjs|json|vo|glob|v|elpi|bin|html|css|svg|txt|tsv)$|\/META$/.test(p) && statSync(p).size > 1024) files.push(p);
});
let raw = 0;
let packed = 0;
let next = 0;
async function worker() {
  while (next < files.length) {
    const p = files[next++];
    const data = readFileSync(p);
    const br = await compress(data, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: data.length },
    });
    raw += data.length;
    if (br.length < data.length * 0.9) {
      writeFileSync(p + ".br", br);
      packed += br.length;
    } else packed += data.length;
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
console.log(
  `${dir}: ${files.length} files, ${(raw / 1e6).toFixed(1)} MB, ${(packed / 1e6).toFixed(1)} MB with brotli (${relative(".", dir)}/rocq: ${readdirSync(join(dir, "rocq")).join(" ")})`,
);
