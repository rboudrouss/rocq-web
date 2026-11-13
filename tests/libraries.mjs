// The libraries of the Packages panel (headless Chromium, as
// tests/browser.mjs): the Files panel's button focusing its form, a GitHub
// repository added (through jsDelivr: the network), its modules listed and
// one required from a file, an error shown, an archive added from disk, the
// filter, a library removed, the list kept after a reload.
//   node tests/libraries.mjs [URL]
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./launch.mjs";

const url = process.argv[2] ?? process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.addInitScript(() => {
  if (sessionStorage.getItem("started")) return;
  sessionStorage.setItem("started", "1");
  localStorage.clear();
  localStorage.setItem("rocq-web:A.v", "Check 1.\n");
  localStorage.setItem("rocq-web:active", "A.v");
  localStorage.setItem("rocq-web:check", "all");
});
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("dialog", (d) => { console.log("[dialog]", d.message()); d.accept(); });
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };
const idle = async () => { await page.waitForTimeout(800); await page.waitForSelector('.status[data-status="Idle"]', { timeout: 180000 }); };
await page.goto(url);
await page.waitForFunction(() => document.querySelector(".log")?.textContent.includes("server ready"), null, { timeout: 120000 });
await idle();

// the Files panel's button opens the Packages panel, its field focused
await page.locator('.files [aria-label="Add a library"]').click();
await page.waitForTimeout(300);
check(await page.locator(".add-library form input").evaluate((i) => i === document.activeElement), "the field focused from Files");

// a GitHub repository
await page.keyboard.type("tchajed/coq-record-update");
await page.keyboard.press("Enter");
await page.waitForSelector(".library-entry", { timeout: 120000 });
check((await page.locator(".add-library form input").inputValue()) === "", "the field emptied");
const entry = page.locator(".library-entry").first();
check((await entry.locator("summary").textContent()).includes("coq-record-update"), "the library listed with its source");
await entry.locator("summary").click();
const mods = await entry.locator(".modules button").allTextContents();
check(mods.includes("RecordUpdate.RecordSet"), `its modules: ${mods}`);
check((await page.locator("header .file").textContent()).includes("A.v"), "A.v still open");
// a module clicked: its Require in A.v, which checks
await entry.locator(".modules button", { hasText: "RecordUpdate.RecordSet" }).click();
await page.waitForTimeout(1500);
await idle();
await page.waitForTimeout(3000);
await idle();
const text = await page.locator(".cm-content").textContent();
check(text.includes("From RecordUpdate Require Import RecordSet."), `the Require inserted: ${text.slice(0, 120)}`);
check((await page.locator(".problems li").count()) === 0, `no problems: ${await page.locator(".problems li").allTextContents()}`);

// an error shown in the panel
await page.locator(".add-library form input").fill("tchajed/coq-record-update@no-such-tag-xyz");
await page.keyboard.press("Enter");
await page.waitForSelector(".add-library .error", { timeout: 60000 });
check(true, `an error: ${await page.locator(".add-library .error").textContent()}`);

// an archive on disk, from the panel
const lib = mkdtempSync(join(tmpdir(), "rocq-web-"));
mkdirSync(join(lib, "mini-1.0", "theories"), { recursive: true });
writeFileSync(join(lib, "mini-1.0", "_CoqProject"), "-R theories Mini\n");
writeFileSync(join(lib, "mini-1.0", "theories", "A.v"), "Definition mini := 1.\n");
execFileSync("tar", ["czf", join(lib, "mini-1.0.tar.gz"), "-C", lib, "mini-1.0"]);
await page.locator('.add-library input[type="file"]').setInputFiles(join(lib, "mini-1.0.tar.gz"));
await page.waitForFunction(() => document.querySelectorAll(".library-entry").length === 2, null, { timeout: 30000 });
check(true, "the archive's library listed");
check(!(await page.locator(".add-library .error").count()), "the error cleared");

// the filter reaches the libraries' modules
await page.locator('.packages input[placeholder^="Search"]').fill("mini");
await page.waitForTimeout(300);
check((await page.locator(".library-entry").count()) === 1, "the filter: of the libraries, mini-1.0 only");
await page.locator('.packages input[placeholder^="Search"]').fill("");
if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });

// removed
await page.locator(".library-entry", { hasText: "mini-1.0" }).locator("summary").click();
await page.locator(".library-entry", { hasText: "mini-1.0" }).locator("button", { hasText: "Remove" }).click();
await page.waitForTimeout(500);
check((await page.locator(".library-entry").count()) === 1, "mini-1.0 removed");
await page.locator('.activity button[aria-label="Files"]').click();
const titles = await page.locator(".files li button.name").evaluateAll((bs) => bs.map((b) => b.title));
check(!titles.some((t) => t.startsWith("mini-1.0")), "its files gone");

// a reload: the library still listed
await page.reload();
await page.waitForFunction(() => document.querySelector(".log")?.textContent.includes("server ready"), null, { timeout: 120000 });
await page.locator('.activity button[aria-label="Packages and libraries"]').click();
check((await page.locator(".library-entry").count()) === 1, "still listed after a reload");
await browser.close();
console.log(`${failed} failed`);
process.exit(failed ? 1 : 0);
