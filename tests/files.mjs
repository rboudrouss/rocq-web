// The app with several files (headless Chromium, as tests/browser.mjs):
// B.v requires A.v, compiled first; the outline, a query, go to
// definition (in A.v, then in Stdlib's sources), the packages, a link
// sharing B.v; and a change of A.v that breaks B.v:
//   node tests/files.mjs [URL]
import { createRequire } from "node:module";
import { join } from "node:path";

const dir = process.env.PLAYWRIGHT_DIR ?? join(process.env.HOME, "tools/pw");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(dir, "browsers");
const { chromium } = createRequire(join(dir, "package.json"))("playwright");
const url = process.argv[2] ?? process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";

const A = "Definition a := 1.\n";
const B = `Require Import A.
From Stdlib Require Import PeanoNat.
Check a.
Lemma t : a = 1. Proof. reflexivity. Qed.
Check Nat.pred_succ.
`;

let failed = false;
const check = (what, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`);
  failed ||= !ok;
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(
  ([a, b]) => {
    if (sessionStorage.getItem("init")) return;
    sessionStorage.setItem("init", "1");
    localStorage.clear();
    localStorage.setItem("rocq-web:A.v", a);
    localStorage.setItem("rocq-web:B.v", b);
    localStorage.setItem("rocq-web:active", "B.v");
  },
  [A, B],
);
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
const idle = () => page.waitForSelector('.status[data-status="Idle"]', { timeout: 120000 });
const tab = (name) => page.locator(".tabs nav button", { hasText: name }).click();
const errors = async () => (await page.locator(".problems li").allTextContents()).filter((t) => t.includes("error"));

const t0 = Date.now();
await page.goto(url);
await idle();
await page.waitForTimeout(500);
await idle();
check("B.v checked with A.v compiled", (await errors()).length === 0, `${Date.now() - t0} ms ${(await errors()).join(" | ")}`);
const log = await page.textContent(".log");
check("A.v compiled", /compiled A\.v/.test(log), log.match(/compiled A\.v[^\n]*?ms/)?.[0]);

await tab("Outline");
await page.waitForSelector(".outline li", { timeout: 10000 }).catch(() => {});
const outline = await page.locator(".outline li").allTextContents();
check("outline", outline.some((t) => t.includes("t")), outline.join(", "));

// a query at the end of the document
await page.locator(".cm-line").last().click();
await tab("Query");
await page.fill(".query input", "About a");
await page.press(".query input", "Enter");
await page.waitForSelector(".query .result", { timeout: 20000 });
const about = await page.textContent(".query .result");
check("query", /Workspace\.A\.a|a : nat/.test(about), about.replace(/\s+/g, " ").slice(0, 120));

// go to the definition of a: A.v
{
  const { x, y } = await page.evaluate(() => {
    const v = window.rocqView, text = v.state.doc.toString();
    const c = v.coordsAtPos(text.indexOf("Check a") + "Check ".length);
    return { x: c.left + 2, y: (c.top + c.bottom) / 2 };
  });
  await page.keyboard.down("Control");
  await page.mouse.click(x, y);
  await page.keyboard.up("Control");
  await page.waitForFunction(() => document.querySelector("header .file")?.textContent === "A.v", null, { timeout: 20000 }).then(
    () => check("definition in the workspace", true, "A.v"),
    () => check("definition in the workspace", false),
  );
}

// change A.v, then B.v fails
await page.evaluate(() => {
  const v = window.rocqView;
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "Definition a := 2.\n" } });
});
await page.waitForTimeout(800);
await tab("Files");
await page.locator(".files li button.name", { hasText: "B.v" }).click();
await page.waitForFunction(() => document.querySelector("header .file")?.textContent === "B.v");
await page.waitForTimeout(500);
await idle();
await tab("Problems");
await page.waitForSelector(".problems li", { timeout: 60000 }).catch(() => {});
const errs = await errors();
check("B.v fails after A.v changed", errs.length > 0, errs.join(" | ").slice(0, 160));

// go to the definition of Nat.pred_succ: Stdlib's PeanoNat.v
{
  const { x, y } = await page.evaluate(() => {
    const v = window.rocqView, text = v.state.doc.toString();
    const c = v.coordsAtPos(text.indexOf("pred_succ") + 2);
    return { x: c.left, y: (c.top + c.bottom) / 2 };
  });
  await page.keyboard.down("Control");
  await page.mouse.click(x, y);
  await page.keyboard.up("Control");
  await page.waitForSelector(".library-bar", { timeout: 20000 }).then(
    async () => check("definition in a library", true, (await page.textContent(".library-bar span"))?.trim()),
    () => check("definition in a library", false),
  );
  const line = await page.evaluate(() => {
    const ed = document.querySelectorAll(".editor .cm-editor")[1];
    return ed?.querySelector(".cm-activeLine")?.textContent ?? "";
  });
  check("at the lemma", /pred_succ/.test(line), line.trim().slice(0, 80));
}

await tab("Packages");
const packages = await page.locator(".packages details").count();
check("packages", packages > 5, `${packages} packages`);
if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });

// a link to B.v, opened in another browser
await page.locator("header button", { hasText: "Share" }).click();
const link = await page.locator(".shared input").inputValue();
{
  const other = await (await browser.newContext()).newPage();
  await other.goto(link);
  await other.waitForSelector(".cm-content");
  const file = await other.textContent("header .file");
  const text = await other.evaluate(() => window.rocqView.state.doc.toString());
  check("shared link", file === "B.v" && text === B, `${link.length} characters, ${file}`);
}

await browser.close();
process.exit(failed ? 1 : 0);
