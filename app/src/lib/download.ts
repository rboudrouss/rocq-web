// Downloads made by the page: a file, a zip archive of files
import { zip } from "./zip";

export function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// [path in the archive, text]
export async function saveZip(files: [string, string][], name: string) {
  const enc = new TextEncoder();
  saveBlob(await zip(files.map(([p, t]) => ({ name: p, data: enc.encode(t) }))), name);
}
