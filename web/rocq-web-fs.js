// Linked (--pre-js) in the web build of the LSP worker: Rocq's files
// (Corelib, Ltac2, the plugins, findlib's META files) in emscripten's file
// system before main runs, from the manifest files.json that
// scripts/assets.mjs writes next to them.
//
// - The files Rocq reads when it starts (the prelude, its plugins) come in
//   one request, boot.bin, fetched with the manifest while the worker's
//   WebAssembly compiles.
// - The others are downloaded when first read (a synchronous request,
//   which a Web Worker may make), so that a document only fetches the
//   libraries and plugins it loads.
// - /workspace is the directory of the user's files (coq-lsp's workspace),
//   the library Workspace (its _RocqProject), where coq/saveVo writes their
//   .vo files.
//
// The assets are at Module.rocqWebAssets (a URL ending in /), by default
// the directory of the worker's script.
if (!(typeof process == "object" && process.versions && process.versions.node)) {
  (function () {
    var base = Module["rocqWebAssets"] || new URL("./", self.location.href).href;
    var get = function (url, as) {
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error(url + ": " + r.status);
        return r[as]();
      });
    };
    var manifest = get(base + "files.json", "json");
    // the version of the files (a hash of their contents) in their URLs,
    // which servers may then cache for good (scripts/serve.mjs)
    var version = function (m) {
      return m.version ? "?v=" + m.version : "";
    };
    var boot = manifest.then(function (m) {
      return m.boot ? get(base + m.boot + version(m), "arrayBuffer") : null;
    });
    // A file node of MEMFS whose contents are fetched on its first read
    var lazyFile = function (path, url, size) {
      var node = FS.createFile(PATH.dirname(path), PATH.basename(path), {}, true, false);
      node.usedBytes = size;
      var load = function () {
        if (node.rocqWebLoaded) return;
        // to the page, which shows what is downloaded
        if (typeof self.postMessage == "function") self.postMessage({ rocqWebFetch: path, size: size });
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
    Module["preRun"] = [].concat(Module["preRun"] || [], function () {
      addRunDependency("rocq-web-files");
      Promise.all([manifest, boot])
        .then(function (r) {
          var m = r[0], pack = r[1];
          m.dirs.forEach(function (d) { FS.mkdirTree(d); });
          // [path, size] or, in boot.bin, [path, size, offset]
          m.files.forEach(function (f) {
            if (pack && f.length > 2) FS.writeFile(f[0], new Uint8Array(pack, f[2], f[1]));
            else lazyFile(f[0], base + f[0].slice(1) + version(m), f[1]);
          });
          FS.mkdirTree("/workspace");
          FS.writeFile("/workspace/_RocqProject", "-R /workspace Workspace\n");
          Object.assign(ENV, m.env);
          removeRunDependency("rocq-web-files");
        })
        .catch(function (e) {
          err("rocq-web: cannot load its files: " + e);
          abort(e);
        });
    });
  })();
}
