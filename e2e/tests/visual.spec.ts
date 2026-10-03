import { expect, test } from "@playwright/test";
import type { BrowseTile } from "@needle/shared";
import type { Page } from "@playwright/test";
import { bar, openAlbum, playContext, signIn } from "./helpers.ts";

test.use({ serviceWorkers: "block" });

const stable = (page: Page) => [
  page.locator("footer.bar"),
  page.locator("aside.right"),
  page.locator(".lib-list"),
  page.locator(".hello"),
];

async function prepareVisualPage(page: Page, path?: string) {
  await signIn(page);
  await openAlbum(page, "Afterglow Avenue");
  await playContext(page);
  await bar(page).getByRole("button", { name: "Pause", exact: true }).click();
  if (path) await page.goto(path);
  await expect(page.locator("aside.right")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to your music" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot("login.png");
});

test("album page", async ({ page }) => {
  await prepareVisualPage(page);
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".hero-art .art.loaded")).toBeVisible();
  await page.locator("#main").evaluate((mainElement) => {
    mainElement.scrollTop = 0;
  });
  await expect.poll(() => page.locator("#main").evaluate((mainElement) => mainElement.scrollTop)).toBe(0);
  await page.mouse.move(700, 60);
  await expect(page).toHaveScreenshot("album.png", {
    mask: [...stable(page), page.locator(".act-end"), page.locator(".tr .col"), page.locator(".tr .heart")],
  });
});

test("search browse", async ({ page }) => {
  const tiles: BrowseTile[] = (
    [
      ["Synthwave", "2 albums", "/genre/Synthwave", 2],
      ["Ambient", "1 album", "/genre/Ambient", 1],
      ["Jazz", "1 album", "/genre/Jazz", 1],
      ["Downtempo", "1 album", "/genre/Downtempo", 1],
      ["House", "1 album", "/genre/House", 1],
      ["Indie Folk", "1 album", "/genre/Indie%20Folk", 1],
      ["Electronic", "1 album", "/genre/Electronic", 1],
      ["2020s", "Decade", "/albums/byYear?from=2020&to=2029", 3],
      ["2010s", "Decade", "/albums/byYear?from=2010&to=2019", 3],
      ["2000s", "Decade", "/albums/byYear?from=2000&to=2009", 1],
      ["1990s", "Decade", "/albums/byYear?from=1990&to=1999", 1],
      ["Recently added", "Newest first", "/albums/newest", 3],
    ] as const
  ).map(([name, subtitle, to, count], index) => ({
    name,
    subtitle,
    to,
    covers: Array.from({ length: count }, (_, cover) => ({
      id: `visual-browse-${index}-${cover}`,
      coverArt: `visual-browse-${index}-${cover}`,
    })),
  }));
  await page.route("**/api/browse", (route) => route.fulfill({ json: tiles }));
  await page.route(
    (url) =>
      url.pathname.endsWith("/getCoverArt.view") && url.searchParams.get("id")?.startsWith("visual-browse-") === true,
    (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><defs><linearGradient id="art"><stop stop-color="#5b2a86"/><stop offset="1" stop-color="#e0457b"/></linearGradient></defs><path fill="url(#art)" d="M0 0h100v100H0z"/></svg>',
      }),
  );
  await prepareVisualPage(page, "/search");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".genre").first()).toBeVisible();
  await expect(page.locator(".genres .art.loaded").first()).toBeVisible();
  await page.mouse.move(700, 60);
  await expect(page).toHaveScreenshot("search.png", { mask: stable(page) });
});

test("settings", async ({ page }) => {
  await prepareVisualPage(page, "/settings");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("settings.png", {
    mask: [
      ...stable(page),
      page.locator(".set-row", { hasText: "Navidrome" }),
      page.locator(".set-row", { hasText: "Device name" }),
    ],
  });
});
