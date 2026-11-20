// The libraries of a link (?lib=SPEC, headless Chromium, as
// tests/browser.mjs): a GitHub repository added from the URL (through
// jsDelivr: the network), listed in the Packages panel, the URL cleaned,
// not added again; a file requiring it shared with it in its link; the
// link opened embedded, in a fresh browser, the library added in memory.
//   node tests/library_links.mjs [URL]
import { launch } from "./launch.mjs";

const url = process.argv[2] ?? process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";
const spec = "tchajed/coq-record-update@v0.3.7";
const text = "From RecordUpdate Require Import RecordSet.\nCheck 1.\n";
const browser = await launch();
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };

async function fresh(init, arg) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] })).newPage();
  if (init) await page.addInitScript(init, arg);
  page.setDefaultNavigationTimeout(120000);
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  page.on("dialog", (d) => { console.log("[dialog]", d.message()); d.accept(); });
  return page;
}
const idle = async (page) => { await page.waitForTimeout(800); await page.waitForSelector('.status[data-status="Idle"]', { timeout: 180000 }); };
const logText = (page) => page.locator(".log").textContent();

// the library of the URL, added
const page = await fresh(([t]) => {
  if (sessionStorage.getItem("started")) return;
  sessionStorage.setItem("started", "1");
  localStorage.clear();
  localStorage.setItem("rocq-web:A.v", t);
  localStorage.setItem("rocq-web:active", "A.v");
  localStorage.setItem("rocq-web:check", "all");
}, [text]);
await page.goto(`${url}?lib=${encodeURIComponent(spec)}`);
await page.waitForSelector(".library-entry", { timeout: 120000 });
check(await page.locator(".sidebar:not([hidden]) .packages").count() === 1, "the Packages panel shown");
check((await page.locator(".library-entry summary").textContent()).includes(spec), "the library listed with its source");
check(!new URL(page.url()).searchParams.has("lib"), `the URL cleaned: ${page.url()}`);
await idle(page);
await page.waitForTimeout(3000);
await idle(page);
check((await page.locator(".problems li").count()) === 0, `A.v checks: ${await page.locator(".problems li").allTextContents()}`);

// a reload with the link again: not added again
await page.goto(`${url}?lib=${encodeURIComponent(spec)}`);
await page.waitForFunction(() => document.querySelector(".log")?.textContent.includes("server ready"), null, { timeout: 120000 });
await page.waitForTimeout(2000);
check(!(await logText(page)).includes("fetching"), "not fetched again");
check((await page.locator(".library-entry").count()) === 1, "listed once");

// a library that cannot be fetched from a link
await page.goto(`${url}?lib=mathcomp`);
await page.waitForFunction(() => document.querySelector(".log")?.textContent.includes("?lib=mathcomp"), null, { timeout: 30000 });
check(true, "a spec that is not a library: logged");

// the share link of A.v: with the library
await page.locator('header [title="Copy a link to this file"]').first().click();
await page.waitForSelector(".shared input");
const shared = await page.locator(".shared input").inputValue();
check(new URL(shared).searchParams.getAll("lib").join() === spec, `the share link has the library: ${shared.slice(0, 120)}`);

// the library's own link, from the Packages panel
await page.locator(".library-entry summary").click();
await page.locator(".library-entry button", { hasText: "Copy a link" }).click();
await page.waitForTimeout(300);
const own = await page.locator(".shared input").inputValue();
check(new URL(own).searchParams.get("lib") === spec && !new URL(own).hash, `the library's link: ${own}`);
await page.context().close();

// the share link embedded, in a fresh browser: the library in memory
const embed = await fresh();
const e = new URL(shared);
e.searchParams.set("embed", "");
await embed.goto(e.href);
await embed.waitForFunction(() => document.querySelector(".log")?.textContent.includes("added the library"), null, { timeout: 120000 });
check(new URL(embed.url()).searchParams.has("lib"), "embedded: the URL kept");
check(await embed.evaluate(() => !Object.keys(localStorage).some((k) => k.startsWith("rocq-web:coq-record-update"))), "embedded: its files not in the user's storage");
check(await embed.evaluate(() => (localStorage.getItem("rocq-web:libraries") ?? "[]") === "[]"), "embedded: the user's list unchanged");
await idle(embed);
await embed.waitForTimeout(3000);
await idle(embed);
check((await embed.locator(".problems li").count()) === 0, `embedded: A.v checks: ${await embed.locator(".problems li").allTextContents()}`);

await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
