// The browser of the tests, with playwright from PLAYWRIGHT_DIR (default
// ~/tools/pw):
//   BROWSER            chromium (default), firefox or webkit
//   ROCQ_WEB_BUILD     compat: memory64 and JSPI disabled in the browser's
//                      engine (page and workers), as in a browser without
//                      them, so that the page picks the compat build
import { createRequire } from "node:module";
import { join } from "node:path";

const dir = process.env.PLAYWRIGHT_DIR ?? join(process.env.HOME, "tools/pw");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(dir, "browsers");
const playwright = createRequire(join(dir, "package.json"))("playwright");

export async function launch(options = {}) {
  const name = process.env.BROWSER ?? "chromium";
  const compat = process.env.ROCQ_WEB_BUILD === "compat";
  const o = { ...options };
  if (compat && name === "chromium")
    o.args = [...(o.args ?? []), "--js-flags=--no-experimental-wasm-memory64 --no-experimental-wasm-jspi"];
  if (compat && name === "firefox")
    o.firefoxUserPrefs = {
      ...o.firefoxUserPrefs,
      "javascript.options.wasm_memory64": false,
      "javascript.options.wasm_js_promise_integration": false,
    };
  return playwright[name].launch(o);
}
