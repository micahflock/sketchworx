import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  base: "./",
  plugins: [preact()],
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@salusoft89/planegcs"] },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
} as any);
