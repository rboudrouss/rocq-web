// The goals panel (headless Chromium, as tests/browser.mjs): Rocq's
// documents laid out for its width, the changes of the sentence at the
// cursor highlighted, hypotheses folded.
//   node tests/goals.mjs
import { createRequire } from "node:module";
import { join } from "node:path";

const dir = process.env.PLAYWRIGHT_DIR ?? join(process.env.HOME, "tools/pw");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(dir, "browsers");
const { chromium } = createRequire(join(dir, "package.json"))("playwright");
const url = process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";

const text = `Lemma l (n m : nat) (H : n = m) : forall k, k + n + (if Nat.eqb n m then 1 else 0) = k + m + (if Nat.eqb m n then 1 else 0).
Proof.
  intros k.
  rewrite H.
  reflexivity.
Qed.
`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.addInitScript((t) => {
  localStorage.clear();
  localStorage.setItem("rocq-web:scratch.v", t);
}, text);
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => document.querySelector(".log")?.textContent.includes("server ready"), null, { timeout: 120000 });
await page.waitForSelector('.status[data-status="Idle"]', { timeout: 120000 });
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};
const at = async (line) => {
  await page.locator(".cm-line").nth(line).click();
  await page.keyboard.press("End");
  await page.waitForTimeout(1500);
};
const goals = () => page.locator('[data-testid="goals"]');

await at(2);
const concl = await goals().locator(".concl").first().textContent();
check(concl.includes("k + n + (if Nat.eqb n m then 1 else 0)"), `after intros: ${JSON.stringify(concl)}`);
check((await goals().locator(".hyp.diff-new").allTextContents()).some((h) => h.startsWith("k")), "k is new");

await at(3);
const marked = await goals().locator(".concl .diff-added").allTextContents();
check(marked.length > 0 && marked.every((w) => w === "m"), `rewrite H highlights ${JSON.stringify(marked)}`);

// narrow: the conclusion on several lines
await page.setViewportSize({ width: 1000, height: 800 });
await page.waitForTimeout(500);
const lines = (await goals().locator(".concl").first().textContent()).split("\n");
check(lines.length > 1, `narrow panel: ${lines.length} lines (${JSON.stringify(lines)})`);
const width = await goals().evaluate((e) => e.clientWidth);
const overflow = await goals().locator(".concl").first().evaluate((e) => e.scrollWidth > e.clientWidth + 1);
check(!overflow, `no overflow in ${width} px`);

// folding H
await goals().locator(".hyp-name", { hasText: "H" }).click();
check((await goals().locator(".hyp", { hasText: "H" }).textContent()).includes("…"), "H folded");
if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });

await browser.close();
console.log(`${failed} failed`);
process.exit(failed ? 1 : 0);
