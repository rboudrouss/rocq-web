/* The worker's messages: the JavaScript side (web/rocq-web-io.js) queues
   the messages it receives; the LSP loop suspends (JSPI, the full build)
   until one arrives, or, without JSPI (the compat build), blocks reading
   them from the memory the page shares with the worker. */
#include <caml/mlvalues.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>

/* 1 when a message is queued, after at most [ms] milliseconds (0: let the
   event loop run once) */
EM_ASYNC_JS(int, rocq_web_wait_js, (double ms), {
  return await globalThis.rocqWeb.wait(ms);
});

/* The same, blocking */
EM_JS(int, rocq_web_wait_sync_js, (double ms), {
  return globalThis.rocqWeb.waitSync(ms);
});

EM_JS(int, rocq_web_suspends_js, (void), {
  return globalThis.rocqWeb.suspends() ? 1 : 0;
});

value rocq_web_wait(value ms)
{
  static int suspends = -1;
  if (suspends < 0) suspends = rocq_web_suspends_js();
  return Val_int(suspends ? rocq_web_wait_js(Double_val(ms)) : rocq_web_wait_sync_js(Double_val(ms)));
}
#else
/* The native build of the bytecode, which only ocaml-emcc runs */
value rocq_web_wait(value ms) { (void)ms; return Val_int(0); }
#endif
