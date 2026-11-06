// Checks FILE.v in the app (headless Chromium, as tests/browser.mjs): the
// time until Rocq is idle, and its errors and warnings (the Problems panel).
//   node tests/page.mjs FILE.v [URL]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const dir = process.env.PLAYWRIGHT_DIR ?? join(process.env.HOME, "tools/pw");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(dir, "browsers");
const { chromium } = createRequire(join(dir, "package.json"))("playwright");
const [file, url = "http://localhost:5173/"] = process.argv.slice(2);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript((text) => localStorage.setItem("rocq-web:scratch.v", text), readFileSync(file, "utf8"));
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url);
await page.waitForSelector('.status[data-status="Busy"]', { timeout: 60000 });
await page.waitForSelector('.status[data-status="Idle"]', { timeout: 600000 });
console.log(`${file}: checked in ${Date.now() - t0} ms`);
for (const p of await page.locator(".problems li").allTextContents()) console.log(`  ${p.slice(0, 240)}`);
await browser.close();
