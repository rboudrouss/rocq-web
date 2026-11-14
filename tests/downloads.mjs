// The files of a Require downloaded in parallel (web/rocq-web-fs.js): a
// large library's (MetaRocq's, 400 files with Stdlib's, Equations's and
// their plugins) requested together, each once, and loaded (headless
// Chromium, as tests/browser.mjs):
//   node tests/downloads.mjs [URL]
import { launch } from "./launch.mjs";

const url = process.argv[2] ?? process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";
const browser = await launch();
const context = await browser.newContext();
const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem("rocq-web:scratch.v", "Check nat.\n");
  localStorage.setItem("rocq-web:check", "all");
});
await page.goto(url);
await page.waitForSelector('.status[data-status="Idle"]', { timeout: 120000 });

// the libraries' and plugins' requests: how many at a time
const library = (r) => /\/(coqlib|plugins)\//.test(r.url());
const urls = [];
let now = 0, most = 0;
context.on("request", (r) => {
  if (!library(r)) return;
  urls.push(r.url());
  most = Math.max(most, ++now);
});
const done = (r) => library(r) && now--;
context.on("requestfinished", done);
context.on("requestfailed", done);

const t0 = Date.now();
const error = await page.evaluate(async () => {
  const c = window.rocq, uri = "file:///workspace/T.v";
  c.open(uri, "From MetaRocq Require Import Common.EnvironmentReflect.\n", 1);
  await c.saveVo(uri, 1).catch(() => {});
  const g = await c.goals(uri, 1, { line: 0, character: 2 }, "After", "Str");
  return g?.error ?? null;
});
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};
check(!error, `Require in ${Date.now() - t0} ms${error ? `: ${JSON.stringify(error).slice(0, 300)}` : ""}`);
check(urls.length > 300, `${urls.length} files`);
check(new Set(urls).size === urls.length, "each requested once");
check(most > 1, `${most} requests at a time`);
console.log(`${failed} failed`);
await browser.close();
process.exit(failed ? 1 : 0);
