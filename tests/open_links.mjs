// The files of a link (?open=SPEC, headless Chromium, as tests/browser.mjs):
// a GitHub repository's folder (through jsDelivr: the network), imported
// as a workspace, its first Rocq file opened, the URL cleaned; ?file=NAME
// opened instead; the whole repository, without its hidden folders; a
// GitHub URL of a folder; an archive served by another site (CORS), its
// files checked, one requiring another, the same link opened again in the
// same folder; a user's folder of the same name left as it is, the link's
// files (or a library of ?lib) in name_2, told; embedded, in memory and
// the URL kept; a spec that is not one, told; the Share dialog: a folder
// opened without a version pinned to its commit, put in the link with
// ?open= and ?file= instead of its files, another added pinned, the link
// (a temporary session) opened in another browser.
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

let dialogs = 0;
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
  page.on("dialog", (d) => { console.log("[dialog]", d.message()); dialogs++; d.accept(); });
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
await opened(page, "src/Lens.v");
check(
  JSON.stringify(await files(page)) ===
    JSON.stringify(["src/Lens.v", "src/RecordEta.v", "src/RecordSet.v", "src/RecordUpdate.v"]),
  `the folder's files: ${await files(page)}`,
);
check((await workspaces(page)).includes("src"), "a workspace, named as the folder");
check(!new URL(page.url()).searchParams.has("open"), `the URL cleaned: ${page.url()}`);
check((await page.locator(".sidebar:not([hidden]) .files").count()) === 1, "the Files panel shown");
await page.close();

// ?file=NAME opened
page = await fresh();
await page.goto(`${url}?open=${encodeURIComponent(`${repo}:src`)}&file=RecordSet.v`);
await opened(page, "src/RecordSet.v");
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
await opened(page, "src/Lens.v");
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
// the same link again: the same folder, nothing asked
dialogs = 0;
await page.goto(`${url}?open=${encodeURIComponent(archive)}&file=A.v`);
await opened(page, "course/A.v");
check(JSON.stringify(await files(page)) === JSON.stringify(["course/A.v", "course/B.v"]) && dialogs === 0, `opened again in course/: ${await files(page)}`);
await page.close();

// a folder of the user's of the same name: left as it is, told
const mine = { "course/Mine.v": "Definition mine := 0.\n", workspaces: JSON.stringify(["course"]) };
page = await fresh(mine);
dialogs = 0;
await page.goto(`${url}?open=${encodeURIComponent(archive)}`);
await opened(page, "course_2/A.v");
check(JSON.stringify(await files(page)) === JSON.stringify(["course/Mine.v", "course_2/A.v", "course_2/B.v"]), `the link's files in course_2/: ${await files(page)}`);
check(dialogs === 0, "nothing asked");
const notice = await page.locator(".shared.warning").textContent();
check(notice.includes("course/") && notice.includes("course_2/"), `told: ${notice}`);
await page.close();

// the same for a library
page = await fresh({ "coq-record-update/Mine.v": "Definition mine := 0.\n", workspaces: JSON.stringify(["coq-record-update"]) });
await page.goto(`${url}?lib=${encodeURIComponent(repo)}`);
await page.waitForSelector(".library-entry", { timeout: 120000 });
const libFiles = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("rocq-web:coq-record-update")).map((k) => k.slice(9)).sort());
check(
  libFiles.includes("coq-record-update/Mine.v") && libFiles.includes("coq-record-update_2/src/RecordSet.v") && !libFiles.includes("coq-record-update/src/RecordSet.v"),
  `the library in coq-record-update_2/: ${libFiles.join(" ")}`,
);
check((await page.locator(".shared.warning").textContent()).includes("coq-record-update_2/"), "told");
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

// The Share dialog
page = await fresh();
await page.goto(`${url}?open=${encodeURIComponent("tchajed/coq-record-update:src")}&file=RecordSet.v`);
await opened(page, "src/RecordSet.v");
await page.waitForTimeout(500);
await page.locator("header button", { hasText: "Share" }).click();
const dialog = page.locator(".share-dialog");
await dialog.waitFor();
const link = async () => { await page.waitForTimeout(800); return new URL(await dialog.locator('[aria-label="The link"]').inputValue()); };
const entry = dialog.locator("label", { hasText: "coq-record-update@" }).first();
const pinned = await entry.locator(".muted").textContent();
check(/^tchajed\/coq-record-update@[0-9a-f]{40}:src$/.test(pinned), `the folder opened, pinned: ${pinned}`);
let u = await link();
check(!u.searchParams.has("open") && /^#(share|files)=/.test(u.hash), "unchecked: the file in the link");
await entry.locator("input").click();
u = await link();
check(u.searchParams.get("open") === pinned && u.searchParams.get("file") === "RecordSet.v" && u.hash === "", `checked: ?open and ?file, no files: ${u.search}${u.hash}`);
await dialog.locator("label", { hasText: "All files" }).locator("input").click();
u = await link();
check(u.hash.startsWith("#share=") || u.hash.startsWith("#files="), "all files: the others in the link");
check(!(await page.evaluate(async (h) => h, u.hash)).includes("RecordSet"), "not those of the folder");
await dialog.locator('[aria-label="A folder for the link to open"]').fill("tchajed/coq-record-update@v0.3.7:tests");
await dialog.locator('[aria-label="A folder for the link to open"]').press("Enter");
await dialog.locator("label", { hasText: ":tests" }).waitFor();
u = await link();
const opens = u.searchParams.getAll("open");
check(opens.length === 2 && /^tchajed\/coq-record-update@[0-9a-f]{40}:tests$/.test(opens[1]), `another, pinned: ${opens}`);
await dialog.locator("label", { hasText: "All files" }).locator("input").click();
const shared = (await link()).href;
await page.close();

check(new URL(shared).search.startsWith("?temp&"), "folders opened: a temporary session by default");
page = await fresh();
await page.goto(shared);
await page.waitForFunction(
  () => document.querySelector(".files")?.textContent.includes("Large.v") && document.querySelector("header .file")?.textContent.includes("src/RecordSet.v"),
  null,
  { timeout: 120000 },
);
check(true, "the link opens both folders, RecordSet.v shown");
await page.close();

await browser.close();
server.close();
if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
