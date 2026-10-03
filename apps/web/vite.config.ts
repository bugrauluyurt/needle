import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const server = process.env.NEEDLE_SERVER ?? "http://127.0.0.1:14535";
const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  version: string;
};
const COMPRESS = /\.(js|css|html|svg|json|webmanifest)$/;

function precompress(): Plugin {
  return {
    name: "needle-precompress",
    apply: "build",
    closeBundle() {
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((f) => {
          const p = join(dir, f);
          return statSync(p).isDirectory() ? walk(p) : [p];
        });
      for (const file of walk("dist").filter((f) => COMPRESS.test(f))) {
        const data = readFileSync(file);
        if (data.length < 1024) continue;
        writeFileSync(`${file}.br`, brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
        writeFileSync(`${file}.gz`, gzipSync(data, { level: 9 }));
      }
    },
  };
}

export default defineConfig({
  define: { __NEEDLE_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    precompress(),
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,svg,png}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/rest\//, /^\/radio\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/rest/getCoverArt"),
            handler: "CacheFirst",
            options: { cacheName: "covers", expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 180 } },
          },
        ],
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/rest": server,
      "/radio": server,
      "/api/devices": { target: server.replace(/^http/, "ws"), ws: true },
      "/api": server,
    },
  },
  build: {
    target: "es2022",
    cssCodeSplit: true,
    sourcemap: false,
    chunkSizeWarningLimit: 400,
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "router", test: /node_modules[\\/](react-router|cookie|set-cookie-parser)[\\/]/ },
            { name: "query", test: /node_modules[\\/](@tanstack|zustand)[\\/]/ },
            {
              name: "ui",
              test: /node_modules[\\/](@radix-ui|@floating-ui|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|use-callback-ref|use-sidecar|aria-hidden|tslib|detect-node-es|get-nonce)[\\/]/,
            },
          ],
        },
      },
    },
  },
});
