import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": `${root}src`,
      "@domain": `${root}src/domain`,
    },
  },
  server: {
    port: 5173,
    // The API key–free server owns persistence; the browser never touches SQLite.
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
