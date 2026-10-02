import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { BrowseTile } from "@needle/shared";
import { openAlbum, signIn } from "./helpers.ts";

const stable = (page: Page) => [page.locator("footer.bar"), page.locator("aside.right"), page.locator(".lib-list"), page.locator(".hello")];

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
  await signIn(page);
  await openAlbum(page, "Afterglow Avenue");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".hero-art .art.loaded")).toBeVisible();
  await page.locator("#main").evaluate((mainElement) => { mainElement.scrollTop = 0; });
  await expect.poll(() => page.locator("#main").evaluate((mainElement) => mainElement.scrollTop)).toBe(0);
  await page.mouse.move(700, 60);
  await expect(page).toHaveScreenshot("album.png", { mask: [...stable(page), page.locator(".act-end"), page.locator(".tr .col"), page.locator(".tr .heart")] });
});

test("search browse", async ({ page }) => {
  const genreRanks = new Map<string, number>(
    ["Synthwave", "Ambient", "Downtempo", "Jazz", "House", "Indie Folk", "Electronic"].map((genreName, genreIndex) => [`/genre/${encodeURIComponent(genreName)}`, genreIndex]),
  );

  await page.route("**/api/browse", async (browseRoute) => {
    const browseResponse = await browseRoute.fetch();

    const browseTiles = await browseResponse.json() as BrowseTile[];
    const orderedBrowseTiles = browseTiles.toSorted((leftTile, rightTile) =>
      (genreRanks.get(leftTile.to) ?? genreRanks.size) - (genreRanks.get(rightTile.to) ?? genreRanks.size));

    await browseRoute.fulfill({ response: browseResponse, json: orderedBrowseTiles });
  });

  await signIn(page, "/search");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".genre").first()).toBeVisible();
  await page.mouse.move(700, 60);
  await expect(page).toHaveScreenshot("search.png", { mask: stable(page) });
});

test("settings", async ({ page }) => {
  await signIn(page, "/settings");
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("settings.png", { mask: [...stable(page), page.locator(".set-row", { hasText: "Navidrome" }), page.locator(".set-row", { hasText: "Device name" })] });
});
