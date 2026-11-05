/* The worker's messages: the JavaScript side (web/lsp-worker.js, or
   tests/lsp.mjs under node) queues the messages it receives; the LSP loop
   suspends (JSPI) until one arrives. */
#include <caml/mlvalues.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>

/* 1 when a message is queued, after at most [ms] milliseconds (0: let the
   event loop run once) */
EM_ASYNC_JS(int, rocq_web_wait_js, (double ms), {
  return await globalThis.rocqWeb.wait(ms);
});

value rocq_web_wait(value ms) { return Val_int(rocq_web_wait_js(Double_val(ms))); }
#else
/* The native build of the bytecode, which only ocaml-emcc runs */
value rocq_web_wait(value ms) { (void)ms; return Val_int(0); }
#endif
