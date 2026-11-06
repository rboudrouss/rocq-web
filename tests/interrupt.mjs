// Interrupting Rocq from the page: an edit while Rocq checks a long
// command (the loop, commented out) stops it, and Rocq is idle again
// (headless Chromium, as tests/browser.mjs):
//   node tests/interrupt.mjs [URL]
import { createRequire } from "node:module";
import { join } from "node:path";

const dir = process.env.PLAYWRIGHT_DIR ?? join(process.env.HOME, "tools/pw");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(dir, "browsers");
const { chromium } = createRequire(join(dir, "package.json"))("playwright");
const url = process.argv[2] ?? "http://localhost:5173/";

// Long, but not deep: nested Ltac loops (the interpreter of Ltac checks
// for interrupts; the reductions of Eval or of unification do not)
const loop = `Goal True.
do 5 (do 1000 (do 1000 idtac)).
Abort.
`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript((text) => localStorage.setItem("rocq-web:scratch.v", text), loop);
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(url);
console.log("isolated:", await page.evaluate(() => crossOriginIsolated));
await page.waitForSelector('.status[data-status="Busy"]', { timeout: 60000 });
await page.waitForTimeout(1000);
await page.evaluate(() => {
  const t0 = performance.now();
  window.__statuses = [];
  new MutationObserver(() =>
    window.__statuses.push(`${Math.round(performance.now() - t0)} ${document.querySelector(".status").textContent}`),
  ).observe(document.querySelector("header"), { subtree: true, childList: true, characterData: true });
});
const t0 = Date.now();
// comment out the loop
await page.locator(".cm-line", { hasText: "do 5" }).click();
await page.keyboard.press("Home");
await page.keyboard.type("(* ");
await page.keyboard.press("End");
await page.keyboard.type(" *)");
await page.waitForSelector('.status[data-status="Idle"]', { timeout: 30000 });
console.log(`idle ${Date.now() - t0} ms after the edit`);
console.log("statuses:", (await page.evaluate(() => window.__statuses)).join(", "));
for (const d of await page.locator(".cm-lintRange").all()) console.log("diagnostic on:", JSON.stringify(await d.textContent()));

await browser.close();
