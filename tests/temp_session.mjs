// A temporary session (?temp, headless Chromium, as tests/browser.mjs): a
// link's files (an archive served with CORS) in memory, the user's own
// neither shown nor changed, the URL kept, told by a banner; the page left
// without a question until a file is changed, then asked; the files kept
// (Keep these files): in the user's workspace, beside a folder of the
// same name in name_2, the change in, the page loaded again without the
// link, told; a library of ?lib kept as one; the Share dialog: a temporary
// session by default when the link opens folders, unchecked as asked, an
// embed always one.
//   node tests/temp_session.mjs [URL]
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./launch.mjs";

const url = process.argv[2] ?? process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";
const repo = "tchajed/coq-record-update@v0.3.7";
const browser = await launch();
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };

const dir = mkdtempSync(join(tmpdir(), "temp-session-"));
mkdirSync(join(dir, "course"));
writeFileSync(join(dir, "course/A.v"), "Definition a := 1.\n");
writeFileSync(join(dir, "course/B.v"), "From course Require Import A.\nLemma b : a = 1. Proof. reflexivity. Qed.\n");
execFileSync("zip", ["-qr", "course.zip", "course"], { cwd: dir });
const zip = readFileSync(join(dir, "course.zip"));
const server = createServer((_, res) => {
  res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Content-Type": "application/zip" });
  res.end(zip);
}).listen(0);
const archive = `http://localhost:${server.address().port}/course.zip`;

const dialogs = [];
async function fresh(seed = {}) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.addInitScript((seed) => {
    if (sessionStorage.getItem("started")) return;
    sessionStorage.setItem("started", "1");
    localStorage.clear();
    localStorage.setItem("rocq-web:check", "all");
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(`rocq-web:${k}`, v);
  }, seed);
  page.setDefaultNavigationTimeout(120000);
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  page.on("dialog", (d) => { dialogs.push(d.type()); d.accept(); });
  return page;
}
const stored = (page) =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => /^rocq-web:.+\.v$/.test(k)).map((k) => k.slice(9)).sort());
const shownFiles = (page) => page.locator(".files").textContent();

const mine = { "course/Mine.v": "Definition mine := 0.\n", workspaces: JSON.stringify(["course"]) };
let page = await fresh(mine);
await page.goto(`${url}?temp&open=${encodeURIComponent(archive)}&file=B.v`);
await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("Lemma b"), null, { timeout: 120000 });
check(JSON.stringify(await stored(page)) === JSON.stringify(["course/Mine.v"]), `the user's files unchanged: ${await stored(page)}`);
const panel = await shownFiles(page);
check(panel.includes("B.v") && !panel.includes("Mine.v") && !panel.includes("scratch.v"), `the session's files shown, not the user's: ${panel}`);
check(new URL(page.url()).searchParams.has("temp") && new URL(page.url()).searchParams.get("open") === archive, "the URL kept");
const banner = page.locator(".shared", { hasText: "Temporary session" });
check((await banner.count()) === 1, "told");
await page.waitForSelector('.status[data-status="Idle"]', { timeout: 180000 });
check((await page.locator(".problems li").count()) === 0, "B.v checks (A.v in memory)");

// left without a question, then changed: asked
dialogs.length = 0;
await page.reload();
await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("Lemma b"), null, { timeout: 120000 });
check(dialogs.length === 0 && (await page.locator(".shared", { hasText: "Temporary session" }).count()) === 1, "reloaded: nothing asked, the link's files again");
await page.locator(".cm-content").click();
await page.keyboard.press("Control+End");
await page.keyboard.type("\nDefinition mine2 := 2.\n");
await page.waitForTimeout(800);
await page.reload();
await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("Lemma b"), null, { timeout: 120000 });
check(dialogs.includes("beforeunload"), `changed: asked before leaving (${dialogs})`);

// kept
await page.locator(".cm-content").click();
await page.keyboard.press("Control+End");
await page.keyboard.type("\nDefinition kept := 3.\n");
dialogs.length = 0;
await Promise.all([page.waitForURL((u) => !u.searchParams.has("temp"), { timeout: 30000 }), banner.locator("button").click()]);
await page.waitForSelector(".shared", { timeout: 30000 });
check(
  JSON.stringify(await stored(page)) === JSON.stringify(["course/Mine.v", "course_2/A.v", "course_2/B.v"]),
  `kept in course_2/, beside the user's course/: ${await stored(page)}`,
);
check(dialogs.length === 0, "kept: nothing asked");
const after = await page.evaluate(() => ({
  b: localStorage.getItem("rocq-web:course_2/B.v"),
  active: localStorage.getItem("rocq-web:active"),
  workspaces: JSON.parse(localStorage.getItem("rocq-web:workspaces")),
}));
check(after.b.includes("Definition kept := 3."), "the change kept");
check(after.active === "course_2/B.v" && after.workspaces.includes("course_2"), `opened, a workspace: ${JSON.stringify(after)}`);
const u = new URL(page.url());
check(!u.search && !u.hash, `the page without the link: ${page.url()}`);
const told = await page.locator(".shared").allTextContents();
check(told.some((t) => t.includes("Kept 2 files") && t.includes("course_2/")) && !told.some((t) => t.includes("Temporary session")), `told: ${told}`);
await page.close();

// a library, kept as one
page = await fresh();
await page.goto(`${url}?temp&lib=${encodeURIComponent(repo)}`);
await page.waitForSelector(".library-entry", { timeout: 120000 });
check((await stored(page)).length === 0, "a library in memory");
await Promise.all([
  page.waitForURL((u) => !u.searchParams.has("temp"), { timeout: 30000 }),
  page.locator(".shared", { hasText: "Temporary session" }).locator("button").click(),
]);
await page.waitForSelector(".library-entry", { timeout: 60000 });
const libs = await page.evaluate(() => JSON.parse(localStorage.getItem("rocq-web:libraries") ?? "[]"));
check(libs.length === 1 && libs[0].folder === "coq-record-update" && libs[0].source === repo, `kept as a library: ${JSON.stringify(libs)}`);
check((await stored(page)).includes("coq-record-update/src/RecordSet.v"), "its files");
await page.close();

// the Share dialog
page = await fresh();
await page.goto(`${url}?open=${encodeURIComponent(archive)}`);
await page.waitForFunction(() => localStorage.getItem("rocq-web:active") === "course/A.v", null, { timeout: 120000 });
await page.locator("header button", { hasText: "Share" }).click();
const dialog = page.locator(".share-dialog");
await dialog.waitFor();
const link = async () => { await page.waitForTimeout(800); return await dialog.locator('[aria-label="The link"]').inputValue(); };
const temp = dialog.locator("label", { hasText: "Temporary session" }).locator("input");
check(!(await temp.isChecked()) && !(await link()).includes("temp"), "no folder opened: not temporary");
await dialog.locator("label", { hasText: "course.zip" }).locator("input").click();
let l = await link();
check((await temp.isChecked()) && new URL(l).search.startsWith("?temp&open="), `a folder opened: temporary by default: ${l}`);
await temp.click();
l = await link();
check(!new URL(l).searchParams.has("temp") && new URL(l).searchParams.has("open"), "unchecked: not temporary");
await dialog.locator("button", { hasText: "Embed" }).click();
await page.waitForTimeout(800);
const html = await dialog.locator('[aria-label="The HTML"]').inputValue();
check((await temp.isChecked()) && (await temp.isDisabled()), "an embed: always temporary");
check(html.includes("?embed&amp;open=") && !html.includes("temp"), "the embed's URL: ?embed only");
await page.close();

await browser.close();
server.close();
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
