// The app with several files (headless Chromium, as tests/browser.mjs):
// B.v requires A.v, compiled first; the outline, a query, go to
// definition (in A.v, then in Stdlib's sources), the packages, a link
// sharing B.v, a folder on disk; and a change of A.v that breaks B.v:
//   node tests/files.mjs [URL]
import { join } from "node:path";
import { launch } from "./launch.mjs";

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

const browser = await launch();
const page = await browser.newPage();
await page.addInitScript(
  ([a, b]) => {
    if (sessionStorage.getItem("init")) return;
    sessionStorage.setItem("init", "1");
    localStorage.clear();
    localStorage.setItem("rocq-web:A.v", a);
    localStorage.setItem("rocq-web:B.v", b);
    localStorage.setItem("rocq-web:active", "B.v");
    localStorage.setItem("rocq-web:check", "all");
  },
  [A, B],
);
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
const idle = () => page.waitForSelector('.status[data-status="Idle"]', { timeout: 120000 });
// a panel: of the activity bar (left), or a tab (right)
const tab = async (name) => {
  const side = page.locator(`.activity button[aria-label="${name}"]`);
  if (await side.count()) {
    if ((await side.getAttribute("aria-pressed")) !== "true") await side.click();
  } else await page.locator(".tabs nav button", { hasText: name }).click();
};
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

// a folder on disk (a fake one: headless Chromium has no picker)
{
  const other = await (await browser.newContext()).newPage();
  await other.addInitScript(() => {
    window.written = {};
    const file = (name, text) => ({
      kind: "file",
      name,
      getFile: async () => new File([text], name),
      createWritable: async () => ({ write: async (t) => (window.written[name] = t), close: async () => {} }),
    });
    window.showDirectoryPicker = async () => ({
      name: "Disk",
      values: async function* () {
        yield file("C.v", "Definition c := 3.\n");
        yield file("not a module.v", "");
      },
    });
  });
  await other.goto(url);
  await other.locator('[aria-label="Open folder on disk"]').click();
  await other.waitForFunction(() => document.querySelector("header .file")?.textContent === "Disk/C.v");
  await other.evaluate(() => {
    const v = window.rocqView;
    v.dispatch({ changes: { from: v.state.doc.length, insert: "Check c.\n" } });
  });
  await other.waitForTimeout(1500);
  const written = await other.evaluate(() => window.written["C.v"]);
  const ws = await other.locator(".files li.dir.workspace").allTextContents();
  check("folder on disk", written === "Definition c := 3.\nCheck c.\n", JSON.stringify(written));
  check("a workspace", ws.some((t) => t.startsWith("Disk/")), ws.join(", "));
}

await browser.close();
process.exit(failed ? 1 : 0);
