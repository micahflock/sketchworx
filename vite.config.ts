import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import preact from "@preact/preset-vite";

/**
 * Build channel: "" for the main site, or a name (SKETCHWORX_CHANNEL=print) for a test copy served
 * beside it on the same site. A channel keeps its own autosave and offline cache.
 */
const CHANNEL = (process.env.SKETCHWORX_CHANNEL ?? "").replace(/[^a-z0-9-]/gi, "");

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
      // A channel's caches get their own prefix, so neither copy's service worker deletes the other's.
      const prefix = CHANNEL ? `sketchworx@${CHANNEL}-` : "sketchworx-";
      const src = readFileSync("src/sw-template.js", "utf8").replaceAll("__PREFIX__", prefix).replace("__VERSION__", version).replace("__PRECACHE__", JSON.stringify(list));
      this.emitFile({ type: "asset", fileName: "sw.js", source: src });
    },
  };
}

/** Short commit the build comes from: git, else GitHub Actions' GITHUB_SHA, else "unknown". */
function commit(): string {
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return process.env.GITHUB_SHA?.slice(0, 7) ?? "unknown";
  }
}

export default defineConfig(({ command }) => ({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync("package.json", "utf8")).version),
    // The dev server shows "dev": its code is whatever is on disk, not a commit.
    __APP_COMMIT__: JSON.stringify(command === "build" ? commit() : "dev"),
    __APP_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    __APP_CHANNEL__: JSON.stringify(CHANNEL),
  },
  plugins: [preact(), serviceWorker()],
  worker: { format: "es" },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
}) as any);
