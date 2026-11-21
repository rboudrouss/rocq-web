// The files of a link (?open=SPEC, headless Chromium, as tests/browser.mjs):
// a GitHub repository's folder (through jsDelivr: the network), imported
// as a workspace, its first Rocq file opened, the URL cleaned; ?file=NAME
// opened instead; the whole repository, without its hidden folders; a
// GitHub URL of a folder; an archive served by another site (CORS), its
// files checked, one requiring another; embedded, in memory and the URL
// kept; a spec that is not one, told.
//   node tests/open_links.mjs [URL]
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

// (an archive, course/A.v and course/B.v requiring it, served with CORS)
const dir = mkdtempSync(join(tmpdir(), "open-links-"));
mkdirSync(join(dir, "course"));
writeFileSync(join(dir, "course/A.v"), "Definition a := 1.\n");
writeFileSync(join(dir, "course/B.v"), "From course Require Import A.\nLemma b : a = 1. Proof. reflexivity. Qed.\n");
writeFileSync(join(dir, "course/notes.bin"), "\0\0");
execFileSync("zip", ["-qr", "course.zip", "course"], { cwd: dir });
const zip = readFileSync(join(dir, "course.zip"));
const server = createServer((_, res) => {
  res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Content-Type": "application/zip" });
  res.end(zip);
}).listen(0);
const archive = `http://localhost:${server.address().port}/course.zip`;

async function fresh() {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.addInitScript(() => {
    if (sessionStorage.getItem("started")) return;
    sessionStorage.setItem("started", "1");
    localStorage.clear();
    localStorage.setItem("rocq-web:check", "all");
  });
  page.setDefaultNavigationTimeout(120000);
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  page.on("dialog", (d) => { console.log("[dialog]", d.message()); d.accept(); });
  return page;
}
const files = (page) =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => /^rocq-web:.+\/.+\.v$/.test(k)).map((k) => k.slice(9)).sort());
const active = (page) => page.evaluate(() => localStorage.getItem("rocq-web:active"));
const workspaces = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("rocq-web:workspaces") ?? "[]"));
const opened = (page, path) =>
  page.waitForFunction((p) => localStorage.getItem("rocq-web:active") === p, path, { timeout: 120000 });
const idle = async (page) => { await page.waitForTimeout(800); await page.waitForSelector('.status[data-status="Idle"]', { timeout: 180000 }); };

// a folder of a repository
let page = await fresh();
await page.goto(`${url}?open=${encodeURIComponent(`${repo}:src`)}`);
await opened(page, "coq-record-update/Lens.v");
check(
  JSON.stringify(await files(page)) ===
    JSON.stringify(["coq-record-update/Lens.v", "coq-record-update/RecordEta.v", "coq-record-update/RecordSet.v", "coq-record-update/RecordUpdate.v"]),
  `the folder's files: ${await files(page)}`,
);
check((await workspaces(page)).includes("coq-record-update"), "a workspace");
check(!new URL(page.url()).searchParams.has("open"), `the URL cleaned: ${page.url()}`);
check((await page.locator(".sidebar:not([hidden]) .files").count()) === 1, "the Files panel shown");
await page.close();

// ?file=NAME opened
page = await fresh();
await page.goto(`${url}?open=${encodeURIComponent(`${repo}:src`)}&file=RecordSet.v`);
await opened(page, "coq-record-update/RecordSet.v");
check(true, "?file=RecordSet.v opened");
check(!new URL(page.url()).searchParams.has("file"), "?file cleaned too");
await page.close();

// the whole repository
page = await fresh();
await page.goto(`${url}?open=${encodeURIComponent(repo)}`);
await page.waitForFunction(() => localStorage.getItem("rocq-web:coq-record-update/tests/Large.v") !== null, null, { timeout: 120000 });
const all = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("rocq-web:coq-record-update/")));
check(all.includes("rocq-web:coq-record-update/src/Lens.v") && all.includes("rocq-web:coq-record-update/_CoqProject"), "the sources and the project file");
check(!all.some((k) => /\.github|README|\.ref$/.test(k)), `not the other files: ${all.length} files`);
await page.close();

// a GitHub URL of a folder
page = await fresh();
await page.goto(`${url}?open=${encodeURIComponent("https://github.com/tchajed/coq-record-update/tree/v0.3.7/src")}`);
await opened(page, "coq-record-update/Lens.v");
check((await files(page)).length === 4, "a GitHub URL: the folder's files");
await page.close();

// an archive, its files checked
page = await fresh();
await page.goto(`${url}?open=${encodeURIComponent(archive)}&file=B.v`);
await opened(page, "course/B.v");
check(JSON.stringify(await files(page)) === JSON.stringify(["course/A.v", "course/B.v"]), `the archive's files: ${await files(page)}`);
check(!(await page.evaluate(() => Object.keys(localStorage).some((k) => k.includes("notes.bin")))), "not its binary file");
await idle(page);
await page.waitForTimeout(3000);
await idle(page);
check((await page.locator(".problems li").count()) === 0, `B.v checks: ${await page.locator(".problems li").allTextContents()}`);
await page.close();

// embedded: in memory, the URL kept
page = await fresh();
await page.goto(`${url}?embed&open=${encodeURIComponent(archive)}`);
await page.waitForFunction(() => document.querySelector(".log")?.textContent.includes("imported 2 files"), null, { timeout: 120000 });
check((await files(page)).length === 0, "embedded: nothing in the browser's storage");
check(new URL(page.url()).searchParams.get("open") === archive, "embedded: the URL kept");
check((await page.locator(".cm-content").textContent()).includes("Definition a"), "embedded: course/A.v opened");
await page.close();

// not a spec
page = await fresh();
await page.goto(`${url}?open=mathcomp`);
await page.waitForSelector(".shared.warning", { timeout: 30000 });
check((await page.locator(".shared.warning").textContent()).includes("?open=mathcomp"), "a spec that is not one: told");
await page.close();

await browser.close();
server.close();
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
