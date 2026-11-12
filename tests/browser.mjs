// Opens the app (served at URL, default http://localhost:5173/) in headless
// Chromium, waits for Rocq to check the example, puts the cursor in its
// proof and prints the goals panel:
//   PLAYWRIGHT_DIR=~/tools/pw node tests/browser.mjs [URL]
// SCREENSHOT=FILE.png: the page once the goals are shown; COLOR_SCHEME=dark.
// PLAYWRIGHT_DIR is a directory with playwright in node_modules, its
// browsers in PLAYWRIGHT_BROWSERS_PATH (default PLAYWRIGHT_DIR/browsers).
import { launch } from "./launch.mjs";

const url = process.argv[2] ?? process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";

const browser = await launch();
const page = await browser.newPage({ colorScheme: process.env.COLOR_SCHEME ?? "light" });
await page.addInitScript(() => {
  localStorage.clear();
  // (checked as it changes, the goals at the cursor)
  localStorage.setItem("rocq-web:check", "all");
});
page.on("console", (m) => console.log(`[console] ${m.text()}`));
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url);
await page.waitForSelector('.status[data-status="Idle"]', { timeout: 120000 });
console.log(`checked in ${Date.now() - t0} ms`);
for (const d of await page.locator(".cm-lintRange").all()) console.log("diagnostic on:", JSON.stringify(await d.textContent()));
// The line "intros n m. ..." of the example: the goal of plus_comm
await page.locator(".cm-line", { hasText: "intros n m" }).click();
await page.keyboard.press("Home");
await page.waitForFunction(() => document.querySelector('[data-testid="goals"]')?.textContent?.includes("n + m"), null, {
  timeout: 30000,
});
console.log("goals:", (await page.textContent('[data-testid="goals"]'))?.trim());
console.log("log:", (await page.textContent(".log"))?.trim().slice(0, 300));
if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });
// Hover on plus_n_Sm, then a unicode completion
{
  // the mouse on IH of "rewrite IH" (rocqView: the editor, in development)
  const { x, y } = await page.evaluate(() => {
    const v = window.rocqView, text = v.state.doc.toString();
    const c = v.coordsAtPos(text.indexOf("rewrite IH") + "rewrite I".length);
    return { x: c.left, y: (c.top + c.bottom) / 2 };
  });
  await page.mouse.move(x, y);
}
await page.waitForSelector(".hover", { timeout: 20000 }).then(
  async (h) => console.log("hover:", (await h.textContent())?.trim().split("\n")[0]),
  () => console.log("hover: none"),
);
await page.locator(".cm-line").last().click();
await page.keyboard.type("Check \\fora");
await page.waitForSelector(".cm-tooltip-autocomplete", { timeout: 20000 }).then(
  async (t) => console.log("completion:", (await t.textContent())?.slice(0, 80)),
  async () =>
    console.log(
      "completion: none; server:",
      JSON.stringify(
        await page.evaluate(() => {
          const t = document.querySelector(".cm-content").innerText.split("\n");
          return window.rocq.completion("file:///workspace/scratch.v", { line: t.length - 1, character: t.at(-1).length });
        }),
      ).slice(0, 200),
    ),
);
await browser.close();
