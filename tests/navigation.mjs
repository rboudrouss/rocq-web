// Moving through a proof (headless Chromium, as tests/browser.mjs): the
// next and previous sentences (Alt+N, Alt+P), problems (F8), and checking
// only up to the cursor (Alt+Enter).
//   node tests/navigation.mjs
import { createRequire } from "node:module";
import { join } from "node:path";

const dir = process.env.PLAYWRIGHT_DIR ?? join(process.env.HOME, "tools/pw");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(dir, "browsers");
const { chromium } = createRequire(join(dir, "package.json"))("playwright");
const url = process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";

const text = `Lemma a : 1 + 1 = 2.
Proof.
  simpl.
  reflexivity.
Qed.
Lemma b : True.
Proof. exact I. Qed.
Check undefined_thing.
`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
await page.addInitScript((t) => {
  if (sessionStorage.getItem("started")) return;
  sessionStorage.setItem("started", "1");
  localStorage.clear();
  localStorage.setItem("rocq-web:scratch.v", t);
}, text);
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};
const start = async () => {
  await page.waitForFunction(() => document.querySelector(".log")?.textContent.includes("server ready"), null, { timeout: 120000 });
  await page.waitForTimeout(500);
  await page.waitForSelector('.status[data-status="Idle"]', { timeout: 120000 });
};
const cursor = () =>
  page.evaluate(() => {
    const s = window.rocqView.state;
    const l = s.doc.lineAt(s.selection.main.head);
    return [l.number - 1, s.selection.main.head - l.from];
  });
const concl = async () => {
  await page.waitForTimeout(1200);
  return (await page.locator('[data-testid="goals"] .concl').first().textContent({ timeout: 3000 }).catch(() => null))?.trim();
};
const problems = () => page.locator(".problems li").allTextContents();

await page.goto(url);
await start();
await page.locator(".cm-content").click();
await page.keyboard.press("Control+Home");
await page.keyboard.press("F8");
check((await cursor())[0] === 7, `F8 goes to the error: ${await cursor()}`);
await page.keyboard.press("Control+Home");
for (let i = 0; i < 3; i++) await page.keyboard.press("Alt+n");
check(JSON.stringify(await cursor()) === "[2,8]", `Alt+N 3 times: after simpl. ${await cursor()}`);
check((await concl()) === "2 = 2", `goals after simpl: ${await concl()}`);
await page.keyboard.press("Alt+p");
check(JSON.stringify(await cursor()) === "[1,6]", `Alt+P: after Proof. ${await cursor()}`);
check((await concl()) === "1 + 1 = 2", `goals after Proof.: ${await concl()}`);

// checking up to the cursor (kept after a reload)
await page.selectOption("header select", "cursor");
await page.reload();
await start();
await page.waitForTimeout(1500);
check((await problems()).length === 0, `nothing checked: ${await problems()}`);
await page.locator(".cm-line").nth(2).click();
await page.keyboard.press("End");
const early = await concl();
check(early == null, `no goals before Alt+Enter: ${early} ${JSON.stringify(await cursor())} ${await page.locator('[data-testid="goals"]').textContent()}`);
await page.keyboard.press("Alt+Enter");
check((await concl()) === "2 = 2", `Alt+Enter: ${await concl()}`);
check((await problems()).length === 0, "the error not checked yet");
check((await page.locator(".cm-unchecked").count()) > 0, "the rest marked unchecked");
await page.keyboard.press("Control+End");
await page.keyboard.press("Alt+Enter");
await page.waitForSelector(".problems li", { timeout: 20000 }).catch(() => {});
check((await problems()).some((p) => p.includes("undefined_thing")), `Alt+Enter at the end: ${await problems()}`);
check((await page.locator(".cm-unchecked").count()) === 0, "all checked");
// back to checking all
await page.selectOption("header select", "all");
await page.evaluate(() => localStorage.setItem("rocq-web:check", "all"));

await browser.close();
console.log(`${failed} failed`);
process.exit(failed ? 1 : 0);
