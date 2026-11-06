// The time the app takes to start, on a short document: until the server
// answers initialize, then until Rocq is idle, with the requests made:
//   node tests/startup.mjs [--record] [URL]
// --record adds the files fetched one by one when Rocq starts to
// web/boot-files.txt, the files of boot.bin (scripts/assets.mjs); delete it
// first to start from none.
import { createRequire } from "node:module";
import { join } from "node:path";

const dir = process.env.PLAYWRIGHT_DIR ?? join(process.env.HOME, "tools/pw");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(dir, "browsers");
const { chromium } = createRequire(join(dir, "package.json"))("playwright");
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const record = args[0] === "--record" && args.shift();
const url = args[0] ?? process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";
const fetched = new Set();
const doc = process.env.DOC ?? "Check nat.\n";

const browser = await chromium.launch();
const context = await browser.newContext();
for (const run of ["cold", "warm"]) {
  const page = await context.newPage();
  await page.addInitScript((text) => localStorage.setItem("rocq-web:scratch.v", text), doc);
  const requests = new Map();
  page.on("requestfinished", async (r) => {
    const m = /\/rocq\/[^/]+(\/(coqlib|plugins)\/[^?]*)/.exec(r.url());
    if (m && run === "cold") fetched.add(decodeURIComponent(m[1]));
    const kind = r.url().replace(/.*\/rocq\/[^/]+\//, "").split("/")[0].replace(/\?.*/, "");
    const s = await r.sizes().catch(() => ({ responseBodySize: 0 }));
    const e = requests.get(kind) ?? { n: 0, bytes: 0 };
    e.n++;
    e.bytes += s.responseBodySize;
    requests.set(kind, e);
  });
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector(".log")?.textContent?.includes("server ready"), null, { timeout: 120000 });
  const ready = Date.now() - t0;
  await page.waitForSelector('.status[data-status="Idle"]', { timeout: 120000 });
  console.log(`${run}: server ready ${ready} ms, idle ${Date.now() - t0} ms`);
  for (const [k, e] of [...requests].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 8))
    console.log(`  ${k}: ${e.n} requests, ${(e.bytes / 1e6).toFixed(1)} MB`);
  await page.close();
}
await browser.close();
if (record) {
  const file = "web/boot-files.txt";
  const all = new Set([...(existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : []), ...fetched]);
  writeFileSync(file, [...all].sort().join("\n") + "\n");
  console.log(`${file}: ${all.size} files (${fetched.size} fetched one by one)`);
}
