// Requires modules of each package of the build (its packages.json: the
// first, middle and last modules of each) in the app, one document each,
// through the page's coq-lsp client (window.rocq): coq/saveVo answers once
// the document is checked, then proof/goals gives the error of the Require
// (headless Chromium, as tests/browser.mjs):
//   node tests/packages.mjs [PACKAGE...]
import { createRequire } from "node:module";
import { join } from "node:path";

const dir = process.env.PLAYWRIGHT_DIR ?? join(process.env.HOME, "tools/pw");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(dir, "browsers");
const { chromium } = createRequire(join(dir, "package.json"))("playwright");
const url = process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";
const only = process.argv.slice(2);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem("rocq-web:scratch.v", "Check nat.\n");
});
// a new worker for each package: coq-lsp keeps what it loaded
const start = async () => {
  await page.goto(url);
  await page.waitForSelector('.status[data-status="Idle"]', { timeout: 120000 });
};
await start();
const packages = await page.evaluate(async () => (await fetch("rocq/full/packages.json")).json());
let failed = 0;
let n = 0;
// (a module that does not exist fails)
packages.unshift({ name: "(check)", modules: ["No.Such.Module"] });
for (const p of packages) {
  if (only.length && !only.includes(p.name) && p.name !== "(check)") continue;
  if (p.name !== "(check)") await start();
  const m = p.modules;
  for (const mod of new Set([m[0], m[m.length >> 1], m[m.length - 1]])) {
    const t0 = Date.now();
    const r = await page.evaluate(
      async ([mod, n]) => {
        const c = window.rocq, uri = `file:///workspace/T${n}.v`;
        c.open(uri, `Require ${mod}.\n`, 1);
        try {
          // (answers once the document is checked)
          const timeout = new Promise((ok) => setTimeout(() => ok("timeout"), 300000));
          if ((await Promise.race([c.saveVo(uri, 1).catch(() => {}), timeout])) === "timeout")
            return "not checked after 300 s";
          const g = await c.goals(uri, 1, { line: 0, character: 2 });
          return g?.error ?? null;
        } catch (e) {
          return e.message;
        } finally {
          c.close(uri);
        }
      },
      [mod, n++],
    );
    if (p.name === "(check)") {
      if (!r) throw new Error("Require No.Such.Module. did not fail");
      continue;
    }
    console.log(`${r ? "FAIL" : "ok  "} ${p.name} ${mod} (${Date.now() - t0} ms)${r ? `: ${r.slice(0, 300)}` : ""}`);
    if (r) failed++;
  }
}
console.log(`${failed} failed`);
await browser.close();
process.exit(failed ? 1 : 0);
