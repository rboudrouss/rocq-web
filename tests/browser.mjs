// Opens the app (served at URL, default http://localhost:5173/) in headless
// Chromium, waits for Rocq to check the example, puts the cursor in its
// proof and prints the goals panel:
//   PLAYWRIGHT_DIR=~/tools/pw node tests/browser.mjs [URL]
// PLAYWRIGHT_DIR is a directory with playwright in node_modules, its
// browsers in PLAYWRIGHT_BROWSERS_PATH (default PLAYWRIGHT_DIR/browsers).
import { createRequire } from "node:module";
import { join } from "node:path";

const dir = process.env.PLAYWRIGHT_DIR ?? join(process.env.HOME, "tools/pw");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(dir, "browsers");
const { chromium } = createRequire(join(dir, "package.json"))("playwright");
const url = process.argv[2] ?? "http://localhost:5173/";

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => console.log(`[console] ${m.text()}`));
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url);
await page.waitForSelector('.status[data-status="Idle"]', { timeout: 120000 });
console.log(`checked in ${Date.now() - t0} ms (build ${await page.textContent("header .muted")})`);
for (const d of await page.locator(".cm-lintRange").all()) console.log("diagnostic on:", JSON.stringify(await d.textContent()));
// The line "intros n m. ..." of the example: the goal of plus_comm
await page.locator(".cm-line", { hasText: "intros n m" }).click();
await page.keyboard.press("Home");
await page.waitForFunction(() => document.querySelector('[data-testid="goals"]')?.textContent?.includes("n + m"), null, {
  timeout: 30000,
});
console.log("goals:", (await page.textContent('[data-testid="goals"]'))?.trim());
console.log("log:", (await page.textContent(".log"))?.trim().slice(0, 300));
if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });
await browser.close();
