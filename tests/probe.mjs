// Runs JavaScript in the app once FILE.v is checked, with c (the page's
// coq-lsp client, window.rocq) and uri (FILE.v's), and prints its result
// as JSON (headless Chromium, as tests/browser.mjs):
//   node tests/probe.mjs FILE.v 'await c.goals(uri, 2, { line: 3, character: 0 })'
import { readFileSync } from "node:fs";
import { launch } from "./launch.mjs";

const [file, code] = process.argv.slice(2);
const url = process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";

const browser = await launch();
const page = await browser.newPage();
await page.addInitScript((text) => {
  localStorage.clear();
  localStorage.setItem("rocq-web:scratch.v", text);
  localStorage.setItem("rocq-web:check", "all");
}, readFileSync(file, "utf8"));
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
if (process.env.CONSOLE) {
  page.on("console", (m) => console.log(`[console] ${m.text()}`));
  page.on("worker", (w) => w.on("console", (m) => console.log(`[worker] ${m.text()}`)));
}
await page.goto(url);
// (idle once the document was opened, the status after its check)
await page.waitForFunction(() => window.rocq && document.querySelector(".log")?.textContent.includes("server ready"), null, { timeout: 120000 });
await page.waitForTimeout(500);
await page.waitForSelector('.status[data-status="Idle"]', { timeout: 600000 });
const r = await page.evaluate(`(async () => { const c = window.rocq, uri = "file:///workspace/scratch.v"; return ${code}; })()`);
console.log(JSON.stringify(r, null, 1));
await browser.close();
