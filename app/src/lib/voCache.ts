// The .vo files compiled from the user's files (lib/project.ts), kept in
// the browser (IndexedDB) from one page load to the next, by a key of what
// they were compiled from: the least recently used dropped beyond a size.
const db = "rocq-web-vo";
const store = "vo";
const limit = 256 << 20;

type Entry = { key: string; data: Uint8Array; size: number; used: number };

let opened: Promise<IDBDatabase | null> | null = null;
function open() {
  opened ??= new Promise((ok) => {
    if (typeof indexedDB === "undefined") return ok(null);
    const rq = indexedDB.open(db, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(store, { keyPath: "key" }).createIndex("used", "used");
    rq.onsuccess = () => ok(rq.result);
    rq.onerror = () => ok(null);
  });
  return opened;
}

const done = (rq: IDBRequest | IDBTransaction) =>
  new Promise<void>((ok, fail) => {
    if (rq instanceof IDBTransaction) {
      rq.oncomplete = () => ok();
      rq.onerror = rq.onabort = () => fail(rq.error);
    } else {
      rq.onsuccess = () => ok();
      rq.onerror = () => fail(rq.error);
    }
  });

export async function getVo(key: string): Promise<Uint8Array | null> {
  const d = await open();
  if (!d) return null;
  try {
    const t = d.transaction(store, "readwrite");
    const rq = t.objectStore(store).get(key);
    await done(rq);
    const e = rq.result as Entry | undefined;
    if (e) t.objectStore(store).put({ ...e, used: Date.now() });
    await done(t);
    return e?.data ?? null;
  } catch {
    return null;
  }
}

export async function putVo(key: string, data: Uint8Array) {
  const d = await open();
  if (!d) return;
  try {
    const t = d.transaction(store, "readwrite");
    const s = t.objectStore(store);
    s.put({ key, data, size: data.length, used: Date.now() } satisfies Entry);
    // (the most recently used kept, up to the limit)
    let total = 0;
    const cursor = s.index("used").openCursor(null, "prev");
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      const e = c.value as Entry;
      total += e.size;
      if (total > limit && e.key !== key) c.delete();
      c.continue();
    };
    await done(t);
  } catch {
    // (a full or unavailable storage: compiled again next time)
  }
}

// The hexadecimal SHA-256 of strings and bytes
export async function digest(...parts: (string | Uint8Array)[]) {
  const enc = new TextEncoder();
  const chunks = parts.map((p) => (typeof p === "string" ? enc.encode(p) : p));
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length + 1, 0));
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length + 1;
  }
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}
