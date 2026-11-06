// Linked (--pre-js) in the LSP worker (worker/lsp_worker.ml): its messages,
// JSON strings, as globalThis.rocqWeb.
//
// - In a Web Worker, from onmessage, and to postMessage.
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
      read();
    }
  } else if (typeof self == "object" && typeof self.postMessage == "function") {
    self.onmessage = function (e) {
      // The flag the page sets to interrupt Rocq: { interrupt: Int32Array }
      // on a SharedArrayBuffer
      if (e.data && e.data.interrupt instanceof Int32Array) interruptFlag = e.data.interrupt;
      else push(typeof e.data == "string" ? e.data : JSON.stringify(e.data));
    };
    post = function (s) {
      self.postMessage(s);
    };
  }
  globalThis.rocqWeb = {
    pop: function () {
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
