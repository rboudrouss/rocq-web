// Serves the static site of scripts/dist.mjs the way it must be served.
//   node scripts/serve.mjs [DIR] [PORT]   (dist and 8080 by default)
//
// The site is cross-origin isolated (COOP and COEP), since the page shares
// memory with the worker to interrupt Rocq. FILE.br is sent when the browser
// accepts brotli. DIR/_redirects rewrites (FROM/* TO/:splat 200) are
// followed as on Netlify. vite's files (assets/, named by their hash) and
// Rocq's files fetched with their version (?v=, web/rocq-web-fs.js) are
// cached for good, and the others revalidated with an ETag.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
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

const redirects = join(dir, "_redirects");
const rewrites = (existsSync(redirects) ? readFileSync(redirects, "utf8").split("\n") : [])
  .map((l) => /^(\S+)\*\s+(\S+):splat\s+200$/.exec(l.trim()))
  .filter(Boolean)
  .map(([, from, to]) => [from, to]);

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
  for (const [from, to] of rewrites) if (path.startsWith(from)) path = to + path.slice(from.length);
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
  // (a proxy that recompresses the file, like Cloudflare, sends it back weak, W/)
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
