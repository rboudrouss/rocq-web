// The workspace (headless Chromium, as tests/browser.mjs): files in
// folders, Load of a file, a required file that does not compile, a zip
// archive of the files, a folder imported (a workspace of its own, its
// project file then written by the user, read again by Rocq), a
// _RocqProject at the root, workspaces requiring one another.
//   node tests/workspace.mjs
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./launch.mjs";

const url = process.argv[2] ?? process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";

const files = {
  "A.v": "Definition a := 1.\nCheck nope.\n",
  "B.v": "Require Import A.\nCheck a.\n",
  "Sub/C.v": "Definition c := 3.\n",
  "L.v": "Definition l := 1.\n",
  "D.v": 'Require Import Sub.C.\nFrom Workspace.Sub Require Import C.\nCheck c.\nLoad "L.v".\nCheck l.\n',
};
const browser = await launch();
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
await page.addInitScript((files) => {
  if (sessionStorage.getItem("started")) return;
  sessionStorage.setItem("started", "1");
  localStorage.clear();
  for (const [n, t] of Object.entries(files)) localStorage.setItem(`rocq-web:${n}`, t);
  localStorage.setItem("rocq-web:active", "D.v");
}, files);
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};
const idle = async () => {
  await page.waitForTimeout(800);
  await page.waitForSelector('.status[data-status="Idle"]', { timeout: 120000 });
};
const start = async () => {
  await page.waitForFunction(() => document.querySelector(".log")?.textContent.includes("server ready"), null, { timeout: 120000 });
  await idle();
};
const problems = () => page.locator(".problems li").allTextContents();
const open = async (name) => {
  await page.locator(".files li button.name", { hasText: new RegExp(`^${name}`) }).first().click();
  await idle();
};

await page.goto(url);
await start();
check((await problems()).length === 0, `D.v: Sub/C.v required, L.v loaded ${await problems()}`);
check((await page.locator(".files li.dir").allTextContents()).includes("Sub/"), "the folder Sub/ in the files");

await open("B.v");
await page
  .waitForFunction(() => [...document.querySelectorAll(".problems li")].some((l) => l.textContent.includes("does not compile")), null, {
    timeout: 15000,
  })
  .catch(() => {});
const pb = await problems();
check(pb.some((p) => p.includes("A.v does not compile")), `B.v: ${pb}`);

// the zip archive of the files
const [download] = await Promise.all([page.waitForEvent("download"), page.locator('[aria-label="Export zip"]').click()]);
check(/\.zip$/.test(download.suggestedFilename()), `zip archive ${download.suggestedFilename()}`);

// a folder imported: the workspace Lib (its modules Lib.*)
const dir = join(mkdtempSync(join(tmpdir(), "rocq-web-")), "Lib");
mkdirSync(join(dir, ".git"), { recursive: true });
writeFileSync(join(dir, "Base.v"), "Definition base := 1.\n");
writeFileSync(join(dir, "Use.v"), "Require Import Base.\nCheck Lib.Base.base.\n");
writeFileSync(join(dir, ".git", "ignored.v"), "");
await page.locator(".files input[webkitdirectory]").setInputFiles(dir);
await page.waitForTimeout(1500);
const titles = await page.locator(".files li button.name").evaluateAll((bs) => bs.map((b) => b.title));
check(titles.includes("Lib/Base.v") && titles.includes("Lib/Use.v") && !titles.some((t) => t.includes(".git")), `imported: ${titles}`);
const wsRows = await page.locator(".files li.dir.workspace").allTextContents();
check(wsRows.some((t) => t.startsWith("Lib/")), `Lib a workspace: ${wsRows}`);
await open("Use.v");
await page.waitForTimeout(1000);
check((await problems()).length === 0, `Lib/Use.v with Lib.Base: ${await problems()}`);

// its project file written: its modules Other.*, read again without a restart
await page.locator(".files li.dir.workspace", { hasText: "Lib/" }).click({ button: "right" });
await page.locator(".context-menu button", { hasText: "Write its _RocqProject" }).click();
await page.waitForFunction(() => document.querySelector("header .file")?.textContent === "Lib/_RocqProject");
await page.evaluate(() => {
  const v = window.rocqView;
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "-R . Other\n" } });
});
await page.waitForFunction(() => document.querySelector(".log")?.textContent.includes("workspaces read again: Lib"), null, { timeout: 30000 }).catch(() => {});
// a new file of Lib, by its menu
await page.locator(".files li.dir.workspace", { hasText: "Lib/" }).click({ button: "right" });
await page.locator(".context-menu button", { hasText: "New file" }).click();
await page.keyboard.type("Use2");
await page.keyboard.press("Enter");
await page.waitForFunction(() => document.querySelector("header .file")?.textContent === "Lib/Use2.v");
await page.evaluate(() => {
  const v = window.rocqView;
  v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "Require Import Base.\nCheck Other.Base.base.\n" } });
});
// (Base.v compiled again as Other.Base, then Use2.v checked again)
await page.waitForFunction(() => document.querySelectorAll(".problems li").length === 0, null, { timeout: 15000 }).catch(() => {});
await idle();
check((await problems()).length === 0, `Lib/Use2.v with Other.Base (project read again): ${await problems()}`);

// a _RocqProject naming the files' modules MyLib.*
await page.evaluate(() => {
  localStorage.setItem("rocq-web:_RocqProject", "-R . MyLib\n");
  localStorage.setItem("rocq-web:E.v", "Require Import MyLib.Sub.C.\nCheck c.\nCheck MyLib.Sub.C.c.\n");
  localStorage.setItem("rocq-web:active", "E.v");
});
await page.reload();
await start();
await page.waitForTimeout(1500);
check((await problems()).length === 0, `E.v with MyLib: ${await problems()}`);

// workspaces requiring one another (From Core Require)
await page.evaluate(() => {
  localStorage.setItem("rocq-web:Core/Base2.v", "Definition core := 2.\n");
  localStorage.setItem("rocq-web:App/Main.v", "From Core Require Import Base2.\nCheck Core.Base2.core.\nCheck core.\n");
  const ws = JSON.parse(localStorage.getItem("rocq-web:workspaces") ?? "[]");
  localStorage.setItem("rocq-web:workspaces", JSON.stringify([...ws, "App", "Core"]));
  localStorage.setItem("rocq-web:active", "App/Main.v");
});
await page.reload();
await start();
await page.waitForTimeout(1500);
const log = () => page.locator(".log").textContent();
check((await problems()).length === 0, `App/Main.v requiring Core.Base2: ${await problems()}`);
check((await log()).includes("compiled Core/Base2.v"), "Core/Base2.v compiled");

await browser.close();
console.log(`${failed} failed`);
process.exit(failed ? 1 : 0);
