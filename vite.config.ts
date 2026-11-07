import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import preact from "@preact/preset-vite";

/** Emit sw.js with the full list of built files so the app works offline after one visit. */
function serviceWorker(): Plugin {
  return {
    name: "sketchworx-sw",
    apply: "build",
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => f !== "sw.js");
      const pub = ["manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"];
      const list = ["./", "./index.html", ...files.map((f) => `./${f}`), ...pub.map((f) => `./${f}`)];
      const version = createHash("sha1").update(list.join("|")).digest("hex").slice(0, 10);
      const src = readFileSync("src/sw-template.js", "utf8").replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify(list));
      this.emitFile({ type: "asset", fileName: "sw.js", source: src });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [preact(), serviceWorker()],
  worker: { format: "es" },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
} as any);
