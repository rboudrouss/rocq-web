// Linked (--pre-js) in the web build of the LSP worker: Rocq's files
// (Corelib, Ltac2, the plugins, findlib's META files) in emscripten's file
// system before main runs, from the manifest files.json that
// scripts/assets.mjs writes next to them.
//
// - The files Rocq reads when it starts (the prelude, its plugins) come in
//   one request, boot.bin, fetched with the manifest while the worker's
//   WebAssembly compiles.
// - The others are downloaded when first read, so that a document only
//   fetches the libraries and plugins it loads: with what the file needs
//   (the manifest's deps: a .vo's libraries and plugins, all those Rocq
//   will read then), at once, by a worker of ours that writes them in
//   shared memory, where the read waits for its file (Atomics.wait). Else
//   (no cross-origin isolation, hence no SharedArrayBuffer), one by one, a
//   synchronous request each, which a Web Worker may make.
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
    // The downloads in parallel: a worker fetching files, each into the
    // SharedArrayBuffer given, then setting its status (1: there, 2:
    // failed) and waking the reads waiting for it
    var fetcher = function () {
      onmessage = function (e) {
        var list = e.data.files, status = new Int32Array(e.data.status), next = 0;
        var one = function () {
          if (next >= list.length) return;
          var i = next++, f = list[i];
          fetch(f.url)
            .then(function (r) {
              if (!r.ok) throw new Error(f.url + ": " + r.status);
              return r.arrayBuffer();
            })
            .then(function (b) {
              if (b.byteLength !== f.data.byteLength) throw new Error(f.url + ": not the size expected");
              new Uint8Array(f.data).set(new Uint8Array(b));
              Atomics.store(status, i, 1);
            })
            .catch(function () {
              Atomics.store(status, i, 2);
            })
            .then(function () {
              Atomics.notify(status, i);
              one();
            });
        };
        // (at a time: HTTP/2 serves them on one connection)
        for (var k = 0; k < 16; k++) one();
      };
      postMessage("ready");
    };
    var parallel = null;
    var started =
      typeof SharedArrayBuffer == "function" && self.crossOriginIsolated && typeof Worker == "function"
        ? new Promise(function (resolve) {
            try {
              var url = URL.createObjectURL(new Blob(["(" + fetcher + ")()"], { type: "text/javascript" }));
              var w = new Worker(url);
              w.onmessage = function () {
                parallel = w;
                resolve();
              };
              w.onerror = function () {
                resolve();
              };
            } catch (e) {
              resolve();
            }
          })
        : null;
    // The lazy files, by their index in the manifest, and what each needs
    var nodes = [];
    var needs = [];
    var isPlugin = function (i) {
      return /\.wasm$/.test(nodes[i].rocqWebPath);
    };
    // Those i needs, itself included, not there yet: in the order Rocq
    // reads them (a .vo, then its libraries; the plugins after, those of
    // a plugin before it)
    var needed = function (i) {
      var vos = [], plugins = [], seen = {};
      var visit = function (j) {
        var n = nodes[j];
        if (seen[j] || !n || n.rocqWebLoaded || n.rocqWebPending) return;
        seen[j] = true;
        var plugin = isPlugin(j);
        if (!plugin) vos.push(j);
        (needs[j] || []).forEach(visit);
        if (plugin) plugins.push(j);
      };
      visit(i);
      return vos.concat(plugins);
    };
    // Downloads those i needs, if more than itself, in parallel
    var prefetch = function (i) {
      if (!parallel) return;
      var list = needed(i);
      if (list.length < 2) return;
      var status = new SharedArrayBuffer(4 * list.length);
      var files = list.map(function (j, k) {
        var n = nodes[j];
        n.rocqWebPending = { status: new Int32Array(status), index: k, data: new SharedArrayBuffer(n.usedBytes) };
        return { url: n.rocqWebUrl, data: n.rocqWebPending.data };
      });
      parallel.postMessage({ status: status, files: files });
    };
    // A file node of MEMFS whose contents are fetched on its first read
    var lazyFile = function (i, path, url, size) {
      var node = FS.createFile(PATH.dirname(path), PATH.basename(path), {}, true, false);
      node.usedBytes = size;
      node.rocqWebPath = path;
      node.rocqWebUrl = url;
      nodes[i] = node;
      var done = function (bytes) {
        node.contents = bytes;
        node.usedBytes = bytes.length;
        node.rocqWebLoaded = true;
        node.rocqWebPending = null;
      };
      var load = function () {
        if (node.rocqWebLoaded) return;
        prefetch(i);
        var p = node.rocqWebPending;
        // to the page, which shows what is downloaded
        if ((!p || Atomics.load(p.status, p.index) === 0) && typeof self.postMessage == "function")
          self.postMessage({ rocqWebFetch: path, size: size });
        if (p) {
          while (Atomics.load(p.status, p.index) === 0) Atomics.wait(p.status, p.index, 0);
          // (a copy: the shared memory is freed with the last of them)
          if (Atomics.load(p.status, p.index) === 1) return done(new Uint8Array(p.data).slice());
        }
        var xhr = new XMLHttpRequest();
        xhr.open("GET", url, false);
        xhr.responseType = "arraybuffer";
        xhr.send(null);
        if (xhr.status !== 200 && xhr.status !== 0) throw new FS.ErrnoError(29 /* EIO */);
        done(new Uint8Array(xhr.response));
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
      Promise.all([manifest, boot, started])
        .then(function (r) {
          var m = r[0], pack = r[1];
          m.dirs.forEach(function (d) { FS.mkdirTree(d); });
          // [path, size] or, in boot.bin, [path, size, offset]
          m.files.forEach(function (f, i) {
            if (pack && f.length > 2) FS.writeFile(f[0], new Uint8Array(pack, f[2], f[1]));
            else lazyFile(i, f[0], base + f[0].slice(1) + version(m), f[1]);
          });
          // [file, what it needs...]
          (m.deps || []).forEach(function (d) {
            needs[d[0]] = d.slice(1);
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
