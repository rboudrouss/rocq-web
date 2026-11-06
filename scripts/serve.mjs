// Serves the static site (scripts/dist.mjs) as it must be served:
// - cross-origin isolated (COOP and COEP), for the memory the page shares
//   with the worker to interrupt Rocq;
// - the brotli compression of a file (FILE.br) when the browser takes it;
// - the files of vite (assets/, named by their hash) and those of Rocq
//   fetched with their version (?v=, web/rocq-web-fs.js) cached for good,
//   the others revalidated (ETag).
//   node scripts/serve.mjs [DIR] [PORT]   (default dist, 8080)
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const dir = process.argv[2] ?? "dist";
const port = Number(process.argv[3] ?? 8080);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".v": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".tsv": "text/tab-separated-values; charset=utf-8",
};

const stat = (p) => {
  try {
    const s = statSync(p);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
};

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let path = normalize(decodeURIComponent(url.pathname));
  if (path.includes("..")) return res.writeHead(400).end();
  if (path.endsWith("/")) path += "index.html";
  let file = join(dir, path);
  let s = stat(file);
  if (!s && !extname(path)) s = stat((file = join(dir, "index.html")));
  if (!s) return res.writeHead(404).end("not found");
  const headers = {
    "Content-Type": types[extname(file)] ?? "application/octet-stream",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
    // vite's files are named by their hash, Rocq's fetched with theirs (?v=)
    "Cache-Control":
      path.startsWith("/assets/") || url.searchParams.has("v") ? "public, max-age=31536000, immutable" : "no-cache",
    Vary: "Accept-Encoding",
  };
  const br = /\bbr\b/.test(req.headers["accept-encoding"] ?? "") && stat(file + ".br");
  const etag = `"${s.size.toString(36)}-${s.mtimeMs.toString(36)}${br ? "-br" : ""}"`;
  headers.ETag = etag;
  // (a proxy recompressing the file, as Cloudflare, sends it back weak: W/)
  const match = (req.headers["if-none-match"] ?? "").split(",").map((t) => t.trim().replace(/^W\//, ""));
  if (match.includes(etag)) return res.writeHead(304, headers).end();
  if (br) {
    headers["Content-Encoding"] = "br";
    headers["Content-Length"] = br.size;
    file += ".br";
  } else headers["Content-Length"] = s.size;
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}/ (${dir})`));
