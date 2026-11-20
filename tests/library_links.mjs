// The libraries of a link (?lib=SPEC, headless Chromium, as
// tests/browser.mjs): a GitHub repository added from the URL (through
// jsDelivr: the network), listed in the Packages panel, the URL cleaned,
// not added again; a file requiring it shared with it in its link; the
// link opened embedded, in a fresh browser, the library added in memory;
// the Share dialog: the link copied at each change, the libraries checked,
// all the files, a library pinned to its last commit, a long link warned;
// all the files opened in another browser, a folder renamed; the HTML of
// the embed, in a cross-origin isolated page of another site.
//   node tests/library_links.mjs [URL]
import { createServer } from "node:http";
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
  localStorage.setItem("rocq-web:W/C.v", "Definition c := 1.\n");
  localStorage.setItem("rocq-web:workspaces", JSON.stringify(["W"]));
  // (random, a long link)
  localStorage.setItem("rocq-web:Big.v", `(* ${Array.from({ length: 12000 }, () => Math.random().toString(36)[2]).join("")} *)\n`);
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

// The Share dialog: its link, and the clipboard's
const dialog = page.locator(".share-dialog");
const link = async () => {
  await page.waitForTimeout(500);
  return dialog.locator('[aria-label="The link"]').inputValue();
};
const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
const box = (text) => dialog.locator("label", { hasText: text }).locator("input");

// A.v's link: with the library it requires, copied
await page.locator("header button", { hasText: "Share" }).click();
await dialog.waitFor();
const shared = await link();
check(new URL(shared).searchParams.getAll("lib").join() === spec, `A.v's link has the library: ${shared.slice(0, 120)}`);
check(new URL(shared).hash.startsWith("#share=A.v:"), "A.v in it");
check((await clipboard()) === shared, "copied");

// the library unchecked: made again and copied
await box("coq-record-update").first().uncheck();
const without = await link();
check(!new URL(without).searchParams.has("lib") && (await clipboard()) === without, "the library left out, copied");
await box("coq-record-update").first().check();

// all the files: those of the library left out, the workspace W kept
check((await dialog.locator("label", { hasText: "All files" }).textContent()).includes("3 files"), "all the files: 3");
await box("All files").check();
const all = await link();
check(new URL(all).hash.startsWith("#files="), `all the files: #files= (${all.length} characters)`);
check(await box("This file").isDisabled(), "the current file then implied");
check(await dialog.locator(".share-warning").count() === 1, `a long link warned: ${await dialog.locator(".share-warning").allTextContents()}`);

// a library added for the link only: at its last commit
await dialog.locator('[aria-label="A library for the link"]').fill("tchajed/coq-record-update");
await dialog.locator(".share-add button").click();
await page.waitForFunction(() => /coq-record-update%40[0-9a-f]{40}/.test(document.querySelector('.share-dialog [aria-label="The link"]').value), null, { timeout: 30000 });
const pinned = new URL(await link()).searchParams.getAll("lib");
check(pinned.length === 2 && /^tchajed\/coq-record-update@[0-9a-f]{40}$/.test(pinned[1]), `pinned to a commit: ${pinned}`);
await box("link only").uncheck();
const allLink = await link();
check(new URL(allLink).searchParams.getAll("lib").join() === spec, "the extra library unchecked");

// the HTML that embeds it: an iframe of the embedded page, copied
await box("All files").uncheck();
await dialog.locator(".segmented button", { hasText: "Embed" }).click();
await page.waitForTimeout(500);
const html = await dialog.locator('[aria-label="The HTML"]').inputValue();
check((await clipboard()) === html, "the HTML copied");
const src = /src="([^"]+)"/.exec(html)?.[1].replace(/&amp;/g, "&");
check(/^<iframe /.test(html) && html.includes('allow="cross-origin-isolated"'), `an iframe: ${html.slice(0, 80)}`);
check(new URL(src).search.startsWith("?embed&lib=") && new URL(src).hash.startsWith("#share=A.v:"), `the embedded page, A.v and its library: ${src.slice(0, 100)}`);
await page.locator(".share-dialog button.info").first().click();
check((await dialog.locator(".info-text").textContent()).includes("Cross-Origin-Embedder-Policy"), "the (i) tells of cross-origin isolation");
await page.locator(".share-dialog button.info").last().click();
check((await dialog.locator(".info-text").last().textContent()).includes("60 such requests an hour"), "the pin's (i) tells of GitHub's limit");
await page.keyboard.press("Escape");
check(await dialog.count() === 0, "closed by Escape");

// a library's Share, from the Packages panel: the library alone
await page.locator(".library-entry summary").click();
await page.locator(".library-entry button", { hasText: "Share" }).click();
const own = await link();
check(new URL(own).searchParams.get("lib") === spec && !new URL(own).hash, `the library's link: ${own}`);
await page.context().close();

// all the files' link in another browser, whose W/C.v differs: W_2/
{
  const other = await fresh(() => {
    if (sessionStorage.getItem("started")) return;
    sessionStorage.setItem("started", "1");
    localStorage.setItem("rocq-web:W/C.v", "(* mine *)\n");
    localStorage.setItem("rocq-web:workspaces", JSON.stringify(["W"]));
  });
  await other.goto(allLink);
  await other.waitForSelector(".cm-content");
  const got = await other.evaluate(() => ({
    A: localStorage.getItem("rocq-web:A.v"),
    C: localStorage.getItem("rocq-web:W/C.v"),
    C2: localStorage.getItem("rocq-web:W_2/C.v"),
    big: (localStorage.getItem("rocq-web:Big.v") ?? "").length,
    ws: JSON.parse(localStorage.getItem("rocq-web:workspaces")),
    active: localStorage.getItem("rocq-web:active"),
  }));
  check(got.A === text && got.active === "A.v", `A.v there and active (${got.active})`);
  check(got.C === "(* mine *)\n" && got.C2 === "Definition c := 1.\n", `W/C.v kept, the link's in W_2/C.v`);
  check(got.ws.includes("W") && got.ws.includes("W_2"), `W_2 a workspace: ${got.ws}`);
  check(got.big > 10000, "Big.v there");
  await other.waitForSelector(".library-entry", { timeout: 120000 });
  check(true, "the library added");
  await other.context().close();
}

// the HTML in a cross-origin isolated page of another site: isolated too,
// A.v checks with the library
{
  const server = createServer((_, res) =>
    res
      .writeHead(200, {
        "Content-Type": "text/html",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      })
      .end(`<!doctype html><h1>A course</h1>${html}`),
  );
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const host = await fresh();
  await host.goto(`http://127.0.0.1:${server.address().port}/`);
  check(await host.evaluate(() => crossOriginIsolated), "the page around it isolated");
  let frame;
  for (let i = 0; i < 100 && !(frame = host.frames().find((f) => f.url().includes("embed"))); i++) await host.waitForTimeout(200);
  await frame.waitForFunction(() => document.querySelector(".log")?.textContent.includes("added the library"), null, { timeout: 120000 });
  check(await frame.evaluate(() => crossOriginIsolated), "the iframe cross-origin isolated");
  await frame.waitForSelector('.status[data-status="Idle"]', { timeout: 180000 });
  check((await frame.locator(".cm-content").textContent()).includes("RecordSet"), "A.v in it");
  await host.context().close();
  server.close();
}

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
