import { defineConfig, devices } from "@playwright/test";

const PORT = 14536;
const chromium = {
  executablePath: process.env.CHROMIUM ?? "/usr/bin/chromium",
  args: ["--autoplay-policy=no-user-gesture-required"],
};
const iphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export default defineConfig({
  testDir: "e2e/tests",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 45_000,
  expect: { timeout: 8_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: chromium,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions: chromium },
      testIgnore: /(mobile|tablet)\.spec/,
    },
    {
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 900, height: 1180 }, launchOptions: chromium },
      testMatch: /tablet\.spec/,
    },
    {
      name: "mobile",
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent: iphone,
        launchOptions: chromium,
      },
      testMatch: /mobile\.spec/,
    },
  ],
  webServer: [
    {
      command: "node e2e/mock-lidarr.ts",
      url: "http://127.0.0.1:14537/api/v1/rootfolder",
      reuseExistingServer: false,
      stdout: "ignore",
    },
    {
      command: "node e2e/mock-soulseek.ts",
      url: "http://127.0.0.1:14538/mb/recording",
      reuseExistingServer: false,
      stdout: "ignore",
      env: { SOULSEEK_DIR: "e2e/.soulseek" },
    },
    {
      command: "node --disable-warning=ExperimentalWarning apps/server/src/index.ts",
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(PORT),
        NAVIDROME_URL: "http://127.0.0.1:14533",
        DATA_DIR: "e2e/.data",
        WEB_DIST: "apps/web/dist",
        LIDARR_URL: "http://127.0.0.1:14537",
        LIDARR_API_KEY: "test-key",
        SLSKD_URL: "http://127.0.0.1:14538",
        SLSKD_API_KEY: "test-slskd",
        SOULSEEK_DIR: "e2e/.soulseek",
        SINGLES_DIR: "e2e/.singles",
        MUSICBRAINZ_URL: "http://127.0.0.1:14538/mb",
        DEEZER_URL: "http://127.0.0.1:14538/deezer",
        LISTENBRAINZ_URL: "http://127.0.0.1:14538/lb",
        TZ: "Europe/Istanbul",
      },
    },
  ],
});
