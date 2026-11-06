// The Web Worker running Rocq (coq-lsp's server): the emscripten build of
// scripts/build.sh, in ./full/ (or ./compat/), with its files.
var build = new URL(self.location.href).searchParams.get("build") || "full";
var base = new URL("./" + build + "/", self.location.href).href;
self.Module = {
  rocqWebAssets: base,
  locateFile: function (path) { return base + path; },
  // the page shows that Rocq stopped (src/lsp.ts)
  onAbort: function (what) { self.postMessage({ rocqWebAbort: String(what) }); },
};
importScripts(base + "lsp_worker.js");
