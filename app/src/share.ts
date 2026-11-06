import { embedded, validName } from "./files";

// A file in the page's URL (#share=NAME:TEXT, the text deflated and in
// base64url), to share it as a link
function toBase64Url(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const fromBase64Url = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

export async function shareUrl(name: string, text: string) {
  const deflated = await pipe(new TextEncoder().encode(text), new CompressionStream("deflate-raw"));
  const url = new URL(location.href);
  url.hash = `share=${encodeURIComponent(name)}:${toBase64Url(deflated)}`;
  return url.href;
}

// The file of the URL, if any
export async function sharedFile(): Promise<{ name: string; text: string } | null> {
  const m = /^#share=([^:]+):(.+)$/.exec(location.hash);
  if (!m) return null;
  try {
    const bytes = await pipe(fromBase64Url(m[2]), new DecompressionStream("deflate-raw"));
    return { name: decodeURIComponent(m[1]), text: new TextDecoder().decode(bytes) };
  } catch {
    return null;
  }
}

// Opens the file of the URL: written to the user's files (under another
// name if one of the same name differs) and made active, the URL cleaned
export async function openShared(
  files: { list: () => string[]; read: (n: string) => string; write: (n: string, t: string) => void; activate: (n: string) => void },
) {
  const f = await sharedFile();
  if (!f || !validName(f.name) || !f.name.endsWith(".v")) return;
  const names = files.list();
  let name = f.name;
  for (let i = 1; names.includes(name) && files.read(name) !== f.text; i++) name = f.name.replace(/\.v$/, `_${i}.v`);
  files.write(name, f.text);
  files.activate(name);
  if (!embedded) history.replaceState(null, "", location.pathname + location.search);
}
