// Moving through a proof (headless Chromium, as tests/browser.mjs): step
// by step, the default (RocqIDE's Alt+arrows and buttons, the goals where
// the checking is, stopped before an error, back before an edit); checking
// as the file changes (kept after a reload): the next and previous
// sentences (Alt+N, Alt+P), problems (F8).
//   node tests/navigation.mjs
import { launch } from "./launch.mjs";

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
const browser = await launch();
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

const goalsText = () => page.locator('[data-testid="goals"]').textContent();
// the lines with checked text
const checkedLines = () => page.locator(".cm-line:has(.cm-checked)").count();

await page.goto(url);
await start();

// step by step
check((await page.locator("header select").inputValue()) === "step", "step by step by default");
await page.waitForTimeout(1500);
check((await problems()).length === 0, `nothing checked: ${await problems()}`);
check((await goalsText()).includes("Nothing checked yet"), `the hint: ${await goalsText()}`);
check((await checkedLines()) === 0, "nothing marked checked");
await page.locator(".cm-content").click();
for (let i = 0; i < 3; i++) await page.keyboard.press("Alt+ArrowDown");
check(JSON.stringify(await cursor()) === "[2,8]", `Alt+Down 3 times: after simpl. ${await cursor()}`);
check((await concl()) === "2 = 2", `goals after simpl: ${await concl()}`);
check((await checkedLines()) === 3, `3 lines checked: ${await checkedLines()}`);
await page.locator(".cm-line").nth(5).click();
check((await concl()) === "2 = 2", `the goals stay when the cursor moves: ${await concl()}`);
await page.keyboard.press("Alt+ArrowUp");
check(JSON.stringify(await cursor()) === "[1,6]", `Alt+Up: after Proof. ${await cursor()}`);
check((await concl()) === "1 + 1 = 2", `goals after Proof.: ${await concl()}`);
await page.locator(".cm-line").nth(2).click();
await page.keyboard.press("End");
await page.keyboard.press("Alt+ArrowRight");
check((await concl()) === "2 = 2", `Alt+Right, up to the cursor: ${await concl()}`);
// the button to the end: stopped before the error
await page.locator('header .nav button[data-move="end"]').click();
await page.waitForSelector('[data-testid="stopped"]', { timeout: 20000 }).catch(() => {});
const stopped = await page.locator('[data-testid="stopped"]').textContent().catch(() => "");
check(stopped.includes("undefined_thing"), `stopped before the error: ${stopped}`);
check(JSON.stringify(await cursor()) === "[6,20]", `the cursor after Qed. ${await cursor()}`);
check((await checkedLines()) === 7, `7 lines checked: ${await checkedLines()}`);
check((await problems()).some((p) => p.includes("undefined_thing")), `the error in the problems: ${await problems()}`);
await page.keyboard.press("Alt+ArrowDown");
await page.waitForTimeout(1000);
check(JSON.stringify(await cursor()) === "[6,20]", `Alt+Down does not go past it: ${await cursor()}`);
// an edit before the point checked up to: checked up to the sentence before
await page.locator(".cm-line").nth(2).click();
await page.keyboard.press("End");
await page.keyboard.type(" ");
check((await checkedLines()) === 3, `an edit: 3 lines checked: ${await checkedLines()}`);
check((await concl()) === "2 = 2", `its goals: ${await concl()}`);
check((await page.locator('[data-testid="stopped"]').count()) === 0, "the error no longer shown");
await page.locator('header .nav button[data-move="start"]').click();
await page.waitForTimeout(500);
check((await checkedLines()) === 0 && (await goalsText()).includes("Nothing checked yet"), "back to the start");

// checking as it changes (kept after a reload)
await page.selectOption("header select", "all");
await page.reload();
await start();
check((await page.locator("header select").inputValue()) === "all", "checking as it changes after a reload");
check((await page.locator("header .nav").count()) === 0, "no step buttons");
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
check((await checkedLines()) === 0, "nothing marked checked");

await browser.close();
console.log(`${failed} failed`);
process.exit(failed ? 1 : 0);
