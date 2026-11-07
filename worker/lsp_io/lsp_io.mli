(** Waiting for the messages of the worker (JSPI, or blocking without). *)

external wait : float -> int = "rocq_web_wait"
(** [wait ms] suspends (or blocks) the program until a message is queued, or for at
    most [ms] milliseconds (0: lets the event loop run once); 1 if a
    message is queued. *)
