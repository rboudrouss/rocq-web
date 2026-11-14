import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Cross-origin isolation, for the SharedArrayBuffer through which the page
// interrupts Rocq (src/lsp.ts)
const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

// In development, rocq/BUILD/ is the build of make full or compat,
// out/BUILD/web (scripts/dist.mjs copies it into the site), or
// $ROCQ_WEB_BUILDS/BUILD (dist/rocq: the site's, while a build runs)
const types: Record<string, string> = { ".wasm": "application/wasm", ".js": "text/javascript", ".json": "application/json" };
const root = fileURLToPath(new URL("..", import.meta.url));
function rocqBuilds(): Plugin {
  return {
    name: "rocq-builds",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/rocq\/(full|compat)\/([^?]*)/.exec(req.url ?? "");
        if (!m) return next();
        const dir = process.env.ROCQ_WEB_BUILDS ? join(root, process.env.ROCQ_WEB_BUILDS, m[1]) : join(root, "out", m[1], "web");
        const file = join(dir, normalize(decodeURIComponent(m[2])));
        let size: number;
        try {
          const s = statSync(file);
          if (!s.isFile()) return next();
          size = s.size;
        } catch {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
        res.setHeader("Content-Length", size);
        res.setHeader("Cache-Control", "no-cache");
        for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  // relative URLs: the site works from any directory of a server
  base: "./",
  plugins: [react(), rocqBuilds()],
  server: { headers },
  preview: { headers },
});
