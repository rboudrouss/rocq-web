/* Interrupting Rocq from the page: at each minor collection, which Rocq's
   allocations make frequent, the flag the page sets in shared memory is
   read (globalThis.rocqWeb.interrupted(), web/rocq-web-io.js), and sets
   Control.interrupt, which Rocq's next Control.check_for_interrupt turns
   into Sys.Break. The hook neither allocates nor runs OCaml code. */
#define CAML_INTERNALS
#include <caml/mlvalues.h>
#include <caml/callback.h>
#include <caml/misc.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>

EM_JS(int, rocq_web_interrupted_js, (void), {
  var w = globalThis.rocqWeb;
  return w && w.interrupted ? w.interrupted() : 0;
});

/* Control.interrupt, a bool ref */
static const value *rocq_web_interrupt;

static void rocq_web_check_interrupt(void)
{
  if (rocq_web_interrupted_js()) Field(*rocq_web_interrupt, 0) = Val_true;
}
#endif

value rocq_web_install_interrupts(value unit)
{
#ifdef __EMSCRIPTEN__
  rocq_web_interrupt = caml_named_value("rocq-web interrupt");
  if (rocq_web_interrupt != NULL) atomic_store(&caml_minor_gc_begin_hook, rocq_web_check_interrupt);
#endif
  return unit;
}
