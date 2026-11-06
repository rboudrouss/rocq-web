import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// public/rocq/full is the build of scripts/build.sh (out/full/web)
// Cross-origin isolation, for the SharedArrayBuffer through which the page
// interrupts Rocq (src/lsp.ts)
const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };

export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [".."] }, headers },
  preview: { headers },
});
