// Linked (--pre-js) in the web build of the LSP worker: Rocq's files
// (Corelib, Ltac2, the plugins, findlib's META files) in emscripten's file
// system before main runs, from the manifest files.json that
// scripts/assets.mjs writes next to them. A file is downloaded when it is
// first read (a synchronous request, which a Web Worker may make), so that
// a document only fetches the libraries and plugins it loads.
//
// The assets are at Module.rocqWebAssets (a URL ending in /), by default
// the directory of the worker's script.
if (!(typeof process == "object" && process.versions && process.versions.node)) {
  Module["preRun"] = [].concat(Module["preRun"] || [], function () {
    var base = Module["rocqWebAssets"] || new URL("./", self.location.href).href;
    // A file node of MEMFS whose contents are fetched on its first read
    var lazyFile = function (path, url, size) {
      var node = FS.createFile(PATH.dirname(path), PATH.basename(path), {}, true, false);
      node.usedBytes = size;
      var load = function () {
        if (node.rocqWebLoaded) return;
        var xhr = new XMLHttpRequest();
        xhr.open("GET", url, false);
        xhr.responseType = "arraybuffer";
        xhr.send(null);
        if (xhr.status !== 200 && xhr.status !== 0) throw new FS.ErrnoError(29 /* EIO */);
        node.contents = new Uint8Array(xhr.response);
        node.usedBytes = node.contents.length;
        node.rocqWebLoaded = true;
      };
      var ops = {};
      Object.keys(node.stream_ops).forEach(function (k) {
        var f = node.stream_ops[k];
        ops[k] = k === "read" || k === "mmap"
          ? function () { load(); return f.apply(this, arguments); }
          : f;
      });
      node.stream_ops = ops;
    };
    addRunDependency("rocq-web-files");
    fetch(base + "files.json")
      .then(function (r) {
        if (!r.ok) throw new Error(base + "files.json: " + r.status);
        return r.json();
      })
      .then(function (m) {
        m.dirs.forEach(function (d) { FS.mkdirTree(d); });
        m.files.forEach(function (f) { lazyFile(f[0], base + f[0].slice(1), f[1]); });
        Object.assign(ENV, m.env);
        removeRunDependency("rocq-web-files");
      })
      .catch(function (e) {
        err("rocq-web: cannot load its files: " + e);
        abort(e);
      });
  });
}
