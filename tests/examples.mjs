// The examples (app/public/examples), each opened by its link
// (?example=ID) and checked without problems, the Examples panel, and the page
// embedded (?embed): its files not in the workspace (headless Chromium,
// as tests/browser.mjs).
//   node tests/examples.mjs [ID...]
import { join } from "node:path";
import { launch } from "./launch.mjs";

const url = process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";
const only = process.argv.slice(2);

const browser = await launch();
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};
const idle = async (page) => {
  await page.waitForFunction(() => document.querySelector(".log")?.textContent.includes("server ready"), null, { timeout: 120000 });
  await page.waitForTimeout(800);
  await page.waitForSelector('.status[data-status="Idle"]', { timeout: 600000 });
};
const problems = (page) => page.locator(".problems li").allTextContents();

const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
// (checked as they change: their problems all known)
await page.addInitScript(() => localStorage.setItem("rocq-web:check", "all"));
await page.goto(url);
const list = await page.evaluate(async () => (await fetch("examples/index.json")).json());
for (const e of list) {
  if (only.length && !only.includes(e.id)) continue;
  for (const f of e.files) {
    const t0 = Date.now();
    await page.goto(`${url}?example=${e.id}&file=${f}`);
    await idle(page);
    const active = await page.locator("header .file").textContent();
    const pb = await problems(page);
    check(active === `${e.id}/${f}` && pb.length === 0, `${active} (${Date.now() - t0} ms) ${pb.join(" | ").slice(0, 300)}`);
    if (e.id === "Extraction") check((await page.locator(".produced").textContent()).includes("sort.ml"), "sort.ml written");
  }
}

await page.goto(url);
await idle(page);
await page.locator('nav.activity button[aria-label="Examples"]').click();
await page.waitForSelector(".examples li");
check((await page.locator(".examples li").count()) === list.length, "the panel lists the examples");
await page.locator(".examples li", { hasText: "Lists" }).click();
await page.waitForTimeout(500);
check((await page.locator("header .file").textContent()).startsWith("Lists"), "opened from the panel");

// embedded
const keys = await page.evaluate(() => Object.keys(localStorage).length);
await page.goto(`${url}?embed&example=Basics`);
await idle(page);
check(!(await page.locator("aside.left").isVisible()), "embedded: no files' panel");
check((await problems(page)).length === 0, "embedded: Basics checked");
check((await page.evaluate(() => Object.keys(localStorage).length)) === keys, "embedded: the workspace unchanged");
if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });

await browser.close();
console.log(`${failed} failed`);
process.exit(failed ? 1 : 0);
