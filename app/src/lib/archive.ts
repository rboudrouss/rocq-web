// The files of an archive: zip (lib/zip.ts), tar, or tar compressed with
// gzip (.tar.gz, .tgz: the browser's DecompressionStream)
import { type Entry, unzip } from "./zip";

async function gunzip(data: Uint8Array) {
  const out = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

// ustar, with the long names of pax headers (path=) and GNU's (././@LongLink)
export function untar(data: Uint8Array): Entry[] {
  const dec = new TextDecoder();
  const str = (at: number, n: number) => {
    const b = data.subarray(at, at + n);
    const end = b.indexOf(0);
    return dec.decode(end < 0 ? b : b.subarray(0, end));
  };
  const out: Entry[] = [];
  let long: string | null = null;
  for (let p = 0; p + 512 <= data.length; ) {
    if (data[p] === 0) break;
    const size = parseInt(str(p + 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(data[p + 156] || 48);
    const prefix = str(p + 257, 6).startsWith("ustar") ? str(p + 345, 155) : "";
    const name = long ?? (prefix ? `${prefix}/${str(p, 100)}` : str(p, 100));
    const body = data.subarray(p + 512, p + 512 + size);
    p += 512 + Math.ceil(size / 512) * 512;
    long = null;
    if (type === "x") {
      const path = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(dec.decode(body))?.[1];
      if (path) long = path;
    } else if (type === "L") long = dec.decode(body).replace(/\0.*$/s, "");
    else if (type === "0" || type === "7") out.push({ name, data: body.slice() });
  }
  return out;
}

export async function readArchive(name: string, data: Uint8Array): Promise<Entry[]> {
  const gz = data[0] === 0x1f && data[1] === 0x8b;
  if (gz) return untar(await gunzip(data));
  if (data[0] === 0x50 && data[1] === 0x4b) return unzip(data.buffer.slice(data.byteOffset, data.byteOffset + data.length) as ArrayBuffer);
  if (/\.tar$/i.test(name) || dec(data.subarray(257, 262)) === "ustar") return untar(data);
  throw new Error(`${name} is not a zip, tar or tar.gz archive`);
}

const dec = (b: Uint8Array) => new TextDecoder().decode(b);
