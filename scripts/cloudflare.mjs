// The site of scripts/dist.mjs for Cloudflare Pages (or a Worker with
// static assets), which serves no file over 25 MiB: those (the
// lsp_worker.wasm of the builds) are served by an R2 bucket at ASSETS_URL
// (a custom domain, its
// CORS policy allowing the site's origin), in a directory named after their
// hash (they must match the lsp_worker.js of the page: an upload replaces
// nothing a deployed page uses, and they are cached for good), where
// rocq/worker.js finds them:
//   node scripts/cloudflare.mjs ASSETS_URL [DIST]
// writes DIST-cloudflare/ (the site, for wrangler pages deploy, without
// the .br files: Cloudflare compresses itself) and DIST-r2/HASH/ (the bucket's new
// files, with their brotli compression, for scripts/r2-upload.sh).
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const [assetsUrl, dist = "dist"] = process.argv.slice(2);
if (!assetsUrl) {
  console.error("usage: node scripts/cloudflare.mjs ASSETS_URL [DIST]");
  process.exit(2);
}
if (!existsSync(join(dist, "rocq/worker.js"))) {
  console.error(`no ${dist}/rocq/worker.js: node scripts/dist.mjs`);
  process.exit(1);
}
const limit = 25 * 1024 * 1024;
// Cloudflare: 20,000 files per deployment on the free plan
const maxFiles = 20000;
const site = `${dist}-cloudflare`, r2 = `${dist}-r2`;
rmSync(site, { recursive: true, force: true });
rmSync(r2, { recursive: true, force: true });
cpSync(dist, site, { recursive: true, filter: (p) => !p.endsWith(".br") });

function walk(d, f) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, f);
    else f(p);
  }
}
const big = [];
let count = 0;
walk(site, (p) => {
  count++;
  if (statSync(p).size > limit) big.push(relative(site, p).split(sep).join("/"));
});
big.sort();
// rocq/worker.js gives emscripten their URL (locateFile): files of a build's
// directory only
for (const f of big)
  if (!/^rocq\/[^/]+\/[^/]+$/.test(f)) {
    console.error(`${f}: over 25 MiB, outside rocq/BUILD/ (rocq/worker.js finds only those elsewhere)`);
    process.exit(1);
  }
if (count - big.length > maxFiles) console.warn(`warning: ${count - big.length} files, over the ${maxFiles} of Cloudflare's free plan`);

const hash = createHash("sha256");
for (const f of big) hash.update(f + "\0").update(readFileSync(join(site, f)));
const version = hash.digest("hex").slice(0, 16);
const base = assetsUrl.replace(/\/+$/, "") + "/" + version + "/";
const remote = {};
for (const f of big) {
  const to = join(r2, version, f);
  mkdirSync(dirname(to), { recursive: true });
  renameSync(join(site, f), to);
  if (existsSync(join(dist, f + ".br"))) cpSync(join(dist, f + ".br"), to + ".br");
  remote[f.slice("rocq/".length)] = base + f;
}
const worker = join(site, "rocq/worker.js");
const source = readFileSync(worker, "utf8");
if (!/^var remote = \{\};$/m.test(source)) {
  console.error(`${worker}: no "var remote = {};" line`);
  process.exit(1);
}
writeFileSync(worker, source.replace(/^var remote = \{\};$/m, `var remote = ${JSON.stringify(remote)};`));
console.log(`${site}: ${count - big.length} files; ${r2}/${version}: ${big.join(" ") || "nothing"}, served from ${base}`);
