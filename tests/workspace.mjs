// The workspace (headless Chromium, as tests/browser.mjs): files in
// folders, Load of a file, a required file that does not compile, a zip
// archive of it written and read back, a _RocqProject.
//   node tests/workspace.mjs
import { launch } from "./launch.mjs";

const url = process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";

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
await page.waitForTimeout(1000);
const pb = await problems();
check(pb.some((p) => p.includes("A.v does not compile")), `B.v: ${pb}`);

// the zip archive, read back into an empty workspace
const [download] = await Promise.all([page.waitForEvent("download"), page.getByText("Export zip").click()]);
const zip = await download.path();
await page.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.endsWith(".v") && k !== "rocq-web:B.v") localStorage.removeItem(k);
});
await page.reload();
await start();
check((await page.locator(".files li button.name").count()) === 1, "one file left");
await page.locator('.files input[type="file"]').setInputFiles(zip);
await page.waitForTimeout(1500);
const names = await page.locator(".files li button.name").evaluateAll((bs) => bs.map((b) => b.title));
check(JSON.stringify(names.sort()) === JSON.stringify(Object.keys(files).sort()), `read back: ${names}`);

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

await browser.close();
console.log(`${failed} failed`);
process.exit(failed ? 1 : 0);
