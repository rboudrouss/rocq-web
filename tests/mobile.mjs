// The page on a phone (headless Chromium, as tests/browser.mjs, a touch
// screen 390 pixels wide): the editor over the goals, the moves between
// them without the keyboard, a line's number touched; the keyboard open
// (the page made lower), the goals on a line over it and the keys; the
// panels over the page; the height shared by a drag; a wide window as
// before.
//   node tests/mobile.mjs
// SCREENSHOTS=DIR: the page at each step, in DIR.
import { launch } from "./launch.mjs";

const url = process.env.ROCQ_WEB_URL ?? "http://localhost:5173/";
const shots = process.env.SCREENSHOTS;

const text = `Theorem add_0_r : forall n : nat, n + 0 = n.
Proof.
  intros n.
  induction n as [| n' IH].
  - reflexivity.
  - simpl.
    rewrite IH.
    reflexivity.
Qed.
`;
const browser = await launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 760 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  colorScheme: process.env.COLOR_SCHEME ?? "light",
});
const page = await context.newPage();
await page.addInitScript((t) => {
  if (sessionStorage.getItem("started")) return;
  sessionStorage.setItem("started", "1");
  localStorage.clear();
  localStorage.setItem("rocq-web:scratch.v", t);
}, text);
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
};
const shot = async (name) => shots && (await page.screenshot({ path: `${shots}/${name}.png` }));
const visible = (selector) => page.locator(selector).first().isVisible();
const editing = () => page.evaluate(() => !!document.activeElement?.closest(".cm-content"));
const concl = async () => (await page.locator('[data-testid="goals"] .concl').first().textContent({ timeout: 3000 }).catch(() => null))?.trim();
const until = (f, what, timeout = 30000) =>
  page.waitForFunction(f, null, { timeout }).then(
    () => true,
    () => (console.log(`  (timed out: ${what})`), false),
  );

await page.goto(url);
await page.waitForFunction(() => document.querySelector(".log")?.textContent.includes("server ready"), null, { timeout: 120000 });
await page.waitForSelector('.status[data-status="Idle"]', { timeout: 120000 });

// The layout
check(await page.locator(".app.mobile").count() === 1, "the mobile layout");
check(await visible(".step-bar"), "the moves under the editor");
check(!(await visible("aside.left")), "no panels shown");
check(await visible('[data-testid="goals"]'), "the goals shown");
{
  const [ed, goals] = await Promise.all([page.locator(".center").boundingBox(), page.locator("aside.right").boundingBox()]);
  check(ed.y + ed.height <= goals.y && ed.height > 200 && goals.height > 200, `the editor (${ed.height | 0}px) over the goals (${goals.height | 0}px)`);
  const page_ = await page.evaluate(() => [document.documentElement.scrollHeight, innerHeight]);
  check(page_[0] <= page_[1], "the page does not scroll");
}
await shot("1-start");

// Step by step, the buttons: the goals, the keyboard not opened
for (let i = 0; i < 6; i++) await page.locator('.step-bar button[data-move="next"]').tap();
check(await until(() => document.querySelector('[data-testid="goals"] .concl')?.textContent.includes("S n' + 0 = S n'"), "goals"), `goals after 6 steps: ${await concl()}`);
check(!(await editing()), "the editor not focused (no keyboard)");
await shot("2-steps");
await page.locator('.step-bar button[data-move="previous"]').tap();
check(await until(() => document.querySelector('[data-testid="goals"] .concl')?.textContent.includes("0 + 0 = 0"), "back one"), `back one: ${await concl()}`);

// A line's number touched: checked up to it
await page.locator(".cm-lineNumbers .cm-gutterElement", { hasText: /^4$/ }).tap();
check(await until(() => document.querySelectorAll('[data-testid="goals"] .concl').length === 2, "2 goals"), `line 4 touched: 2 goals (${await page.locator('[data-testid="goals"] .concl').count()})`);
check(!(await editing()), "still no keyboard");
await shot("3-line-number");

// The keyboard: the editor focused, the page lower (as the keyboard makes it)
await page.locator(".cm-line", { hasText: "rewrite IH" }).tap();
await page.setViewportSize({ width: 390, height: 430 });
check(await until(() => document.querySelector(".app.keyboard"), "keyboard layout", 5000), "the keyboard layout");
check(!(await visible("aside.right")) && !(await visible(".step-bar")), "the goals' panel and the moves hidden");
check(await visible('[data-testid="peek"]') && await visible(".keys"), "the goals on a line and the keys");
const appBox = await page.locator(".app").boundingBox();
check(appBox.height <= 430 + 1, `the page as high as the part shown (${appBox.height})`);
await page.locator('.keys button[data-move="cursor"]').tap();
check(await until(() => document.querySelector('[data-testid="peek"]')?.textContent.includes("S n' = S n'"), "peek"), `peek: ${await page.locator('[data-testid="peek"]').textContent()}`);
check(await editing(), "the editor keeps the focus");
await shot("4-keyboard");
// a key typed: the text, the focus kept
await page.keyboard.press("End");
await page.locator(".keys button", { hasText: /^->$/ }).tap();
check((await page.evaluate(() => window.rocqView.state.doc.toString())).includes("rewrite IH.->"), "a key typed at the cursor");
check(await editing(), "the focus kept");
await page.keyboard.press("Backspace");
await page.keyboard.press("Backspace");
// the peek touched: the keyboard closed
await page.locator('[data-testid="peek"]').tap();
check(!(await editing()), "the peek touched: the editor not focused");
await page.setViewportSize({ width: 390, height: 760 });
check(await until(() => !document.querySelector(".app.keyboard"), "keyboard closed", 5000) && (await visible(".step-bar")), "back to the goals' panel");

// The panels: over the page, closed once used
await page.locator('header button[aria-label="Panels"]').tap();
check(await visible("aside.left"), "the panels shown");
await page.locator('aside.left .activity button[aria-label="Outline"]').tap();
await shot("5-panels");
await page.locator("aside.left .outline li button").first().tap();
check(!(await visible("aside.left")), "an outline's item touched: the panels closed");
await page.locator('header button[aria-label="Panels"]').tap();
await page.locator(".scrim").tap({ position: { x: 370, y: 400 } });
check(!(await visible("aside.left")), "the scrim touched: the panels closed");

// The menu: the mode
await page.locator('header button[aria-label="More"]').tap();
check(await visible("header .menu select"), "the menu");
await shot("6-menu");
await page.locator('header button[aria-label="More"]').tap();

// The height shared by a drag
{
  const before = (await page.locator(".center").boundingBox()).height;
  const grip = await page.locator(".step-bar .grip").boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, 250, { steps: 5 });
  await page.mouse.up();
  const after = (await page.locator(".center").boundingBox()).height;
  check(after < before - 100, `the editor lower after a drag (${before | 0} -> ${after | 0})`);
  await page.reload();
  await page.waitForSelector(".app.mobile");
  const kept = (await page.locator(".center").boundingBox()).height;
  check(Math.abs(kept - after) < 5, `kept after a reload (${kept | 0})`);
  await shot("7-drag");
  await page.evaluate(() => localStorage.removeItem("rocq-web:split"));
}

// A wide window: as before
await page.setViewportSize({ width: 1300, height: 800 });
check(await until(() => !document.querySelector(".app.mobile"), "desktop", 5000), "a wide window: not the mobile layout");
check(await visible("header .nav") && await visible("nav.activity") && !(await visible(".step-bar")), "the header's moves, the activity bar");
await shot("8-desktop");

await browser.close();
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
