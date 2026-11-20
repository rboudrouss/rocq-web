// Files other than Rocq's (headless Chromium, as tests/browser.mjs): a
// workspace's .elpi file read by a Rocq file with Extra Dependency, an edit
// of it seen by that file and by the files requiring it (compiled again),
// and the page's settings not listed as files.
//   node tests/extra_dependency.mjs [URL]
import { launch } from "./launch.mjs";

const url = process.argv[2] ?? process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";

const lib = `From elpi Require Import elpi.
From Workspace Extra Dependency "hello.elpi" as hello.
Elpi Command hello.
Elpi Accumulate File hello.
Elpi Accumulate lp:{{ main _ :- greeting S, coq.say S. }}.
Elpi hello.
Elpi Command def.
Elpi Accumulate File hello.
Elpi Accumulate lp:{{ main _ :- value N, coq.env.add-const "x" N _ ff _. }}.
Elpi def.
`;
const main = `Require Import Lib.
Compute x.
`;
const elpi = (n) => `pred greeting o:string.
greeting "hello v${n}".
pred value o:term.
value {{ ${n} }}.
`;

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
await page.addInitScript(
  ([lib, main, elpi]) => {
    if (sessionStorage.getItem("started")) return;
    sessionStorage.setItem("started", "1");
    localStorage.clear();
    localStorage.setItem("rocq-web:Lib.v", lib);
    localStorage.setItem("rocq-web:Main.v", main);
    localStorage.setItem("rocq-web:+hello.elpi", elpi);
    localStorage.setItem("rocq-web:active", "Lib.v");
    localStorage.setItem("rocq-web:check", "all");
  },
  [lib, main, elpi(1)],
);
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};
const idle = async () => {
  await page.waitForTimeout(800);
  await page.waitForSelector('.status[data-status="Idle"]', { timeout: 180000 });
};
const open = async (name) => {
  await page.locator(".files button.name", { hasText: name }).first().click();
  await page.waitForTimeout(500);
};
// the messages of line [line] (0-based), the cursor on its final dot (just
// after it, coq-lsp answers for what follows)
const messages = async (line) => {
  await idle();
  await page.locator(".cm-line").nth(line).click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(1500);
  return (await page.locator('[data-testid="goals"] .message').allTextContents()).join(" | ");
};

await page.goto(url);
await page.waitForFunction(() => document.querySelector(".log")?.textContent.includes("server ready"), null, { timeout: 120000 });
await idle();

const files = await page.locator(".files button.name").allTextContents();
check(JSON.stringify(files.map((f) => f.trim()).sort()) === JSON.stringify(["Lib.v", "Main.v", "hello.elpi"]), `the files only: ${files}`);

let m = await messages(5);
check(m.includes("hello v1"), `Elpi hello. reads hello.elpi: ${m}`);

await open("Main.v");
m = await messages(1);
check(m.includes("= 1"), `Main.v: Lib compiled with x = 1: ${m}`);

await open("hello.elpi");
check(!(await page.locator(".cm-content .tok-keyword").count()), "hello.elpi without Rocq highlighting");
await page.evaluate((t) => window.rocqView.dispatch({ changes: { from: 0, to: window.rocqView.state.doc.length, insert: t } }), elpi(2));
await page.waitForTimeout(1000);
check((await page.evaluate(() => localStorage.getItem("rocq-web:+hello.elpi"))).includes("hello v2"), "hello.elpi saved");

await open("Lib.v");
m = await messages(5);
check(m.includes("hello v2"), `Elpi hello. after the edit: ${m}`);

await open("Main.v");
m = await messages(1);
check(m.includes("= 2"), `Main.v: Lib compiled again, x = 2: ${m}`);

await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
