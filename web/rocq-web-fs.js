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
//   .vo files, the current directory; the page writes and reads files there
//   (globalThis.rocqWebFs).
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
    // the version to the page (the .vo it keeps were compiled against
    // these libraries: app/src/lib/project.ts)
    manifest.then(function (m) {
      if (typeof self.postMessage == "function") self.postMessage({ rocqWebVersion: m.version });
    });
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
    // The page's requests on the files of the worker, { id, op, path,
    // data }, answered by { rocqWebFsReply: { id, result } } or { id,
    // error }, in their order once the files are set up:
    // - write: path's contents (a string or bytes), its directories made;
    // - remove: a file;
    // - list: the files under path, [path, size, mtime (ms)] of each;
    // - read: a file's bytes.
    var queued = [];
    var ready = false;
    var files = function (dir, out) {
      FS.readdir(dir).forEach(function (n) {
        if (n === "." || n === "..") return;
        var p = (dir === "/" ? "" : dir) + "/" + n;
        var st = FS.stat(p);
        if (FS.isDir(st.mode)) files(p, out);
        else out.push([p, st.size, st.mtime.getTime()]);
      });
      return out;
    };
    var run = function (rq) {
      var result = null;
      switch (rq.op) {
        case "write":
          FS.mkdirTree(PATH.dirname(rq.path));
          FS.writeFile(rq.path, rq.data);
          break;
        case "remove":
          if (FS.analyzePath(rq.path).exists) FS.unlink(rq.path);
          break;
        case "list":
          result = FS.analyzePath(rq.path).exists ? files(rq.path, []) : [];
          break;
        case "read":
          result = FS.readFile(rq.path);
          break;
        default:
          throw new Error("unknown operation " + rq.op);
      }
      return result;
    };
    globalThis.rocqWebFs = function (rq) {
      if (!ready) return queued.push(rq);
      var reply = { id: rq.id };
      try {
        reply.result = run(rq);
      } catch (e) {
        reply.error = String(e && e.message || e);
      }
      if (rq.id !== undefined) self.postMessage({ rocqWebFsReply: reply });
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
          // (Load, Extraction... write and read relative to the workspace)
          FS.chdir("/workspace");
          Object.assign(ENV, m.env);
          // the page's files first (its _RocqProject)
          ready = true;
          queued.splice(0).forEach(globalThis.rocqWebFs);
          removeRunDependency("rocq-web-files");
        })
        .catch(function (e) {
          err("rocq-web: cannot load its files: " + e);
          abort(e);
        });
    });
  })();
}
