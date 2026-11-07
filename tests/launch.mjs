// The browser of the tests, with playwright from PLAYWRIGHT_DIR (default
// ~/tools/pw):
//   BROWSER            chromium (default), firefox or webkit
//   ROCQ_WEB_BUILD     compat: the page picks the compat build, JSPI
//                      missing (Firefox: disabled; Chromium, whose flags no
//                      longer disable it: hidden from the page)
import { createRequire } from "node:module";
import { join } from "node:path";

const dir = process.env.PLAYWRIGHT_DIR ?? join(process.env.HOME, "tools/pw");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(dir, "browsers");
const playwright = createRequire(join(dir, "package.json"))("playwright");

const hideJSPI = () => {
  delete WebAssembly.Suspending;
  delete WebAssembly.promising;
};

export async function launch(options = {}) {
  const name = process.env.BROWSER ?? "chromium";
  const compat = process.env.ROCQ_WEB_BUILD === "compat";
  const o = { ...options };
  if (compat && name === "firefox")
    o.firefoxUserPrefs = { ...o.firefoxUserPrefs, "javascript.options.wasm_js_promise_integration": false };
  const browser = await playwright[name].launch(o);
  if (compat && name !== "firefox") {
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (o) => {
      const c = await newContext(o);
      await c.addInitScript(hideJSPI);
      return c;
    };
    browser.newPage = async (o) => {
      const c = await browser.newContext(o);
      const p = await c.newPage();
      const close = p.close.bind(p);
      p.close = async (...a) => {
        await close(...a);
        await c.close();
      };
      return p;
    };
  }
  return browser;
}
