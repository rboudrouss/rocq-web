// Linked (--pre-js) in the LSP worker (worker/lsp_worker.ml): its messages,
// JSON strings, as globalThis.rocqWeb.
//
// - In a Web Worker, from onmessage (with JSPI, the program suspending
//   while it waits), or, without JSPI (the compat build, which cannot
//   return to the event loop: it blocks), from the channel the page shares
//   with it (app/src/channel.ts), which carries the page's messages and its
//   operations on the files then; to postMessage.
// - Under node, LSP over stdin and stdout (Content-Length headers), for
//   tests and editors. ocaml-emcc runs compiled programs in a worker thread
//   there (a large stack), which is where stdin is read, through its file
//   descriptor; the main thread only waits.
(function () {
  var queue = [];
  var interruptFlag = null;
  var waiter = null;
  var post;
  function push(s) {
    queue.push(s);
    if (waiter) {
      var w = waiter;
      waiter = null;
      w();
    }
  }
  // whether the program suspends to wait (JSPI: emscripten's Asyncify
  // object, for EM_ASYNC_JS), known once the program's code is loaded
  function suspends() {
    return typeof Asyncify != "undefined";
  }
  // The channel (compat build): a ring of bytes in a SharedArrayBuffer,
  // ctrl[0] the bytes written, ctrl[1] those read; records of a 4-byte
  // length (its high bit: the message goes on in the next record) and
  // their bytes; a message is a kind byte, then for 0 a string (UTF-8), for
  // 1 an operation on the files (the length of its JSON, the JSON, its
  // data: text or bytes)
  var channel = null;
  var partial = [];
  var utf8 = typeof TextDecoder == "function" ? new TextDecoder() : null;
  function readChannel() {
    if (!channel) return 0;
    var ctrl = channel.ctrl, data = channel.data, size = data.length;
    var head = Atomics.load(ctrl, 0), tail = Atomics.load(ctrl, 1);
    function bytes(at, n) {
      var i = (at >>> 0) % size, out = new Uint8Array(n);
      var first = Math.min(n, size - i);
      out.set(data.subarray(i, i + first));
      if (first < n) out.set(data.subarray(0, n - first), first);
      return out;
    }
    while (tail !== head) {
      var h = bytes(tail, 4);
      var len = (h[0] | (h[1] << 8) | (h[2] << 16) | (h[3] << 24)) >>> 0;
      var n = len & 0x7fffffff;
      partial.push(bytes(tail + 4, n));
      tail = (tail + 4 + n) | 0;
      if (len & 0x80000000) continue;
      var total = 0;
      partial.forEach(function (p) { total += p.length; });
      var m = new Uint8Array(total), o = 0;
      partial.forEach(function (p) { m.set(p, o); o += p.length; });
      partial = [];
      if (m[0] === 0) push(utf8.decode(m.subarray(1)));
      else {
        var jl = m[1] | (m[2] << 8) | (m[3] << 16) | (m[4] << 24);
        var rq = JSON.parse(utf8.decode(m.subarray(5, 5 + jl)));
        var body = m.subarray(5 + jl);
        if (rq.data === "text") rq.data = utf8.decode(body);
        else if (rq.data === "bytes") rq.data = body.slice();
        else delete rq.data;
        globalThis.rocqWebFs(rq);
      }
    }
    Atomics.store(ctrl, 1, tail);
    return head;
  }
  var channelWait = null;
  var isNode = typeof process == "object" && process.versions && process.versions.node;
  if (isNode) {
    var fs = require("fs");
    var threads = require("worker_threads");
    var runsHere = !threads.isMainThread || process.env.OCAML_EMCC_STACK_MB === "0";
    post = function (s) {
      var body = Buffer.from(s, "utf8");
      fs.writeSync(1, "Content-Length: " + body.length + "\r\n\r\n");
      fs.writeSync(1, body);
    };
    if (runsHere) {
      var pending = Buffer.alloc(0);
      var parse = function () {
        for (;;) {
          var end = pending.indexOf("\r\n\r\n");
          if (end < 0) return;
          var m = /Content-Length: *(\d+)/i.exec(pending.subarray(0, end).toString("latin1"));
          var len = m ? Number(m[1]) : 0;
          if (pending.length < end + 4 + len) return;
          push(pending.subarray(end + 4, end + 4 + len).toString("utf8"));
          pending = pending.subarray(end + 4 + len);
        }
      };
      var read = function () {
        var chunk = Buffer.alloc(65536);
        fs.read(0, chunk, 0, chunk.length, null, function (err, n) {
          if (err && err.code === "EAGAIN") return setTimeout(read, 10);
          if (err || n === 0) return push('{"jsonrpc":"2.0","method":"exit"}');
          pending = Buffer.concat([pending, chunk.subarray(0, n)]);
          parse();
          read();
        });
      };
      // (without JSPI, waitSync reads stdin, blocking, unless it is only
      // to let the event loop run)
      var syncRead = function () {
        var chunk = Buffer.alloc(65536), n;
        try {
          n = fs.readSync(0, chunk, 0, chunk.length, null);
        } catch (e) {
          if (e.code === "EAGAIN") return;
          n = 0;
        }
        if (n === 0) return push('{"jsonrpc":"2.0","method":"exit"}');
        pending = Buffer.concat([pending, chunk.subarray(0, n)]);
        parse();
      };
      setTimeout(function () {
        if (suspends()) read();
        else channelWait = function (ms) {
          if (ms > 0) syncRead();
        };
      }, 0);
    }
  } else if (typeof self == "object" && typeof self.postMessage == "function") {
    self.onmessage = function (e) {
      // The flag the page sets to interrupt Rocq: { interrupt: Int32Array }
      // on a SharedArrayBuffer
      if (e.data && e.data.interrupt instanceof Int32Array) interruptFlag = e.data.interrupt;
      else if (e.data && e.data.rocqWebChannel) {
        var b = e.data.rocqWebChannel;
        channel = { ctrl: new Int32Array(b, 0, 4), data: new Uint8Array(b, 16) };
        if (channelPending) removeRunDependency("rocq-web-channel");
        channelPending = false;
      }
      // the files of the page in the worker's (web/rocq-web-fs.js)
      else if (e.data && e.data.rocqWebFs) globalThis.rocqWebFs(e.data.rocqWebFs);
      else push(typeof e.data == "string" ? e.data : JSON.stringify(e.data));
    };
    post = function (s) {
      self.postMessage(s);
    };
    // without JSPI, main waits for the channel
    var channelPending = false;
    Module["preRun"] = [].concat(Module["preRun"] || [], function () {
      if (!suspends() && !channel) {
        channelPending = true;
        addRunDependency("rocq-web-channel");
      }
    });
    channelWait = function (ms) {
      var head = readChannel();
      if (!queue.length && channel && ms > 0) {
        Atomics.wait(channel.ctrl, 0, head, ms);
        readChannel();
      }
    };
  }
  globalThis.rocqWeb = {
    pop: function () {
      if (!queue.length && channel) readChannel();
      if (!queue.length) return null;
      // the edit which set the flag is being handled
      if (interruptFlag) Atomics.store(interruptFlag, 0, 0);
      return queue.shift();
    },
    post: function (s) {
      post(s);
    },
    // 1 if the page asked to interrupt Rocq since the last call
    // (worker/plugins/interrupt.c)
    interrupted: function () {
      return interruptFlag && Atomics.exchange(interruptFlag, 0, 0) ? 1 : 0;
    },
    suspends: suspends,
    // The same as wait, blocking (worker/lsp_io/lsp_io.c)
    waitSync: function (ms) {
      if (!queue.length && channelWait) channelWait(ms);
      return queue.length ? 1 : 0;
    },
    // 1 once a message is queued, 0 after [ms] milliseconds without
    wait: function (ms) {
      if (queue.length) return Promise.resolve(1);
      return new Promise(function (resolve) {
        var timer = setTimeout(function () {
          waiter = null;
          resolve(queue.length ? 1 : 0);
        }, ms);
        waiter = function () {
          clearTimeout(timer);
          resolve(1);
        };
      });
    },
  };
})();
