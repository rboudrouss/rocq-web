import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// public/rocq/full is the build of scripts/build.sh (out/full/web)
export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [".."] } },
});
