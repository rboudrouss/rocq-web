// Interrupting Rocq from the page: an edit while Rocq checks a long
// command (commented out by the edit) stops it, and Rocq is idle again
// (headless Chromium, as tests/browser.mjs):
//   node tests/interrupt.mjs [ltac|compute] [URL]
// ltac: a loop of Ltac's interpreter, which checks for interrupts;
// compute: a reduction, which does not (stopped from a Memprof callback)
import { join } from "node:path";
import { launch } from "./launch.mjs";

const kind = process.argv[2] ?? "ltac";
const url = process.argv[3] ?? process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";

const long = { ltac: "do 5 (do 1000 (do 1000 idtac)).", compute: "Eval compute in Nat.even (Nat.pow 3 13)." }[kind];
const loop = `Goal True.
${long}
Abort.
`;

const browser = await launch();
const page = await browser.newPage();
await page.addInitScript((text) => {
    localStorage.setItem("rocq-web:scratch.v", text);
    localStorage.setItem("rocq-web:check", "all");
  }, loop);
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
await page.locator(".cm-line", { hasText: long }).click();
await page.keyboard.press("Home");
await page.keyboard.type("(* ");
await page.keyboard.press("End");
await page.keyboard.type(" *)");
await page.waitForSelector('.status[data-status="Idle"]', { timeout: 30000 });
console.log(`idle ${Date.now() - t0} ms after the edit`);
console.log("statuses:", (await page.evaluate(() => window.__statuses)).join(", "));
for (const d of await page.locator(".cm-lintRange").all()) console.log("diagnostic on:", JSON.stringify(await d.textContent()));

await browser.close();
