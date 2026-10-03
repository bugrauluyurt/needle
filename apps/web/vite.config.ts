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
      const walk = (directory: string): string[] =>
        readdirSync(directory).flatMap((directoryEntry) => {
          const filePath = join(directory, directoryEntry);

          return statSync(filePath).isDirectory() ? walk(filePath) : [filePath];
        });

      for (const filePath of walk("dist").filter((candidateFilePath) => COMPRESS.test(candidateFilePath))) {
        const fileContents = readFileSync(filePath);

        if (fileContents.length < 1024) continue;

        writeFileSync(
          `${filePath}.br`,
          brotliCompressSync(fileContents, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
        );
        writeFileSync(`${filePath}.gz`, gzipSync(fileContents, { level: 9 }));
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
        importScripts: ["/sw-cleanup.js"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/rest\//, /^\/radio\//],
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
        codeSplitting: {
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
