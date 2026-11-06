// The search of the libraries' sources (headless Chromium, as
// tests/browser.mjs): a declaration found by its name and by words of its
// statement, its source shown at it.
//   node tests/search.mjs
import { createRequire } from "node:module";
import { join } from "node:path";

const dir = process.env.PLAYWRIGHT_DIR ?? join(process.env.HOME, "tools/pw");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(dir, "browsers");
const { chromium } = createRequire(join(dir, "package.json"))("playwright");
const url = process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};
await page.goto(url);
await page.locator(".tabs nav button", { hasText: "Search" }).click();
const input = page.locator(".library-search input");
const t0 = Date.now();
await input.fill("pred_succ");
await page.waitForSelector(".library-search li", { timeout: 30000 });
const first = await page.locator(".library-search li").first().textContent();
check(first.includes("pred_succ"), `pred_succ (index in ${Date.now() - t0} ms): ${first}`);
await input.fill("rev involutive");
await page.waitForTimeout(300);
const found = await page.locator(".library-search li b").allTextContents();
check(found.includes("rev_involutive"), `rev involutive: ${found.slice(0, 5)}`);
await page.locator(".library-search li", { hasText: "rev_involutive" }).first().click();
await page.waitForSelector(".library-bar", { timeout: 20000 });
const bar = await page.locator(".library-bar").textContent();
check(bar.includes(".v"), `source shown: ${bar}`);
const line = await page.locator(".library .cm-activeLine").textContent().catch(() => "");
check(line.includes("rev_involutive"), `at the declaration: ${line}`);
await browser.close();
console.log(`${failed} failed`);
process.exit(failed ? 1 : 0);
