import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const dir = join(import.meta.dirname, "../public/icons");
const renders: [string, string, number][] = [
  ["icon.svg", "icon-192.png", 192],
  ["icon.svg", "icon-512.png", 512],
  ["maskable.svg", "maskable-512.png", 512],
  ["apple-touch-icon.svg", "apple-touch-icon.png", 180],
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium" });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [svg, png, size] of renders) {
  await page.setViewportSize({ width: size, height: size });
  const markup = readFileSync(join(dir, svg), "utf8").replace("<svg ", `<svg width="${size}" height="${size}" `);
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${markup}`);
  await page.screenshot({ path: join(dir, png), omitBackground: true });
}
await browser.close();
