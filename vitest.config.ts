import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": `${root}src`,
      "@domain": `${root}src/domain`,
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/**/*.test.ts", "src/**/*.test.tsx",
      "server/**/*.test.ts", "corpus/**/*.test.ts",
    ],
  },
});
