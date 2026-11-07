// The page's messages to a worker that cannot receive them by postMessage
// while it waits (the compat build: without JSPI, it blocks instead of
// returning to the event loop): written in memory shared with the worker,
// which reads them (web/rocq-web-io.js). A ring of bytes: ctrl[0] the bytes
// written, ctrl[1] those read; records of a 4-byte length (its high bit:
// the message goes on in the next record) and their bytes. A message is a
// kind byte, then for 0 a string (UTF-8), for 1 an operation on the files
// (the length of its JSON, the JSON, then its data: text or bytes).
const SIZE = 4 << 20;

export class Channel {
  readonly buffer = new SharedArrayBuffer(16 + SIZE);
  private ctrl = new Int32Array(this.buffer, 0, 4);
  private data = new Uint8Array(this.buffer, 16);
  private queue: Uint8Array[] = [];
  private offset = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private enc = new TextEncoder();

  send(s: string) {
    const b = this.enc.encode(s);
    const m = new Uint8Array(1 + b.length);
    m.set(b, 1);
    this.push(m);
  }

  sendFs(rq: { id: number; op: string; path: string; data?: string | Uint8Array }) {
    const { data, ...rest } = rq;
    const body = typeof data === "string" ? this.enc.encode(data) : (data ?? new Uint8Array(0));
    const json = this.enc.encode(
      JSON.stringify({ ...rest, data: typeof data === "string" ? "text" : data ? "bytes" : undefined }),
    );
    const m = new Uint8Array(5 + json.length + body.length);
    m[0] = 1;
    new DataView(m.buffer).setUint32(1, json.length, true);
    m.set(json, 5);
    m.set(body, 5 + json.length);
    this.push(m);
  }

  private push(m: Uint8Array) {
    this.queue.push(m);
    this.pump();
  }

  // As much of the queue as the ring has room for, the rest once the
  // worker read some
  private pump() {
    const ctrl = this.ctrl;
    while (this.queue.length) {
      const m = this.queue[0];
      const head = Atomics.load(ctrl, 0);
      const free = SIZE - ((head - Atomics.load(ctrl, 1)) | 0);
      if (free <= 4) break;
      const n = Math.min(m.length - this.offset, free - 4, SIZE >> 1);
      const more = this.offset + n < m.length;
      const h = new Uint8Array(4);
      new DataView(h.buffer).setUint32(0, (n | (more ? 0x80000000 : 0)) >>> 0, true);
      this.write(head, h);
      this.write(head + 4, m.subarray(this.offset, this.offset + n));
      Atomics.store(ctrl, 0, (head + 4 + n) | 0);
      Atomics.notify(ctrl, 0);
      this.offset += n;
      if (!more) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    if (this.queue.length && this.timer === null)
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, 5);
  }

  private write(at: number, b: Uint8Array) {
    const i = (at >>> 0) % SIZE;
    const first = Math.min(b.length, SIZE - i);
    this.data.set(b.subarray(0, first), i);
    if (first < b.length) this.data.set(b.subarray(first), 0);
  }
}
