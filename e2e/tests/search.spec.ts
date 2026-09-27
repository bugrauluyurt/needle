import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";

test("browses by genre and decade before typing", async ({ page }) => {
  await signIn(page, "/search");
  await expect(page.getByRole("heading", { name: "Browse your library" })).toBeVisible();
  await expect(page.locator(".genre", { hasText: "Synthwave" })).toBeVisible();
  await expect(page.locator(".genre", { hasText: "2010s" })).toBeVisible();
  await expect(page.locator(".genre", { hasText: "1960s" })).toHaveCount(0);
  await page.locator(".genre", { hasText: "2020s" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "The 2020s" })).toBeVisible();
  await expect(page.locator(".card-link", { hasText: "Night Transit" })).toBeVisible();
});

test("searches as you type, with a top result and filters", async ({ page }) => {
  await signIn(page, "/search");
  await page.getByRole("searchbox", { name: "Search", exact: true }).fill("neon");
  await expect(page).toHaveURL(/q=neon/);
  await expect(page.locator(".top-card h2")).toHaveText("Neon Harbor");
  await expect(page.locator(".songs-mini .song-mini")).toHaveCount(4);
  const filters = page.getByRole("group", { name: "Filter results" });
  await filters.getByRole("button", { name: "Songs", exact: true }).click();
  await expect(page.locator(".tr").first()).toBeVisible();
  await filters.getByRole("button", { name: "Artists", exact: true }).click();
  await expect(page.locator(".card", { hasText: "Neon Harbor" })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search", exact: true }).fill("zzzz nothing");
  await expect(page.getByText("No artists in your library match “zzzz nothing”.")).toBeVisible();
});

test("finds text anywhere in names, in search and in the library list", async ({ page }) => {
  await signIn(page, "/search?q=arbor");
  await expect(page.locator(".top-card h2")).toHaveText("Neon Harbor");
  const side = page.locator("nav.side");
  await side.getByRole("button", { name: "Search in your library" }).click();
  await side.getByRole("searchbox", { name: "Search in your library" }).fill("field");
  await expect(side.locator(".lib-item", { hasText: "Weightless Hours" })).toBeVisible();
  await expect(side.locator(".lib-item", { hasText: "Night Transit" })).toHaveCount(0);
  await side.getByRole("searchbox", { name: "Search in your library" }).fill("zzzz");
  await expect(side.getByText("Nothing in your library matches “zzzz”.")).toBeVisible();
});

test("remembers recent searches", async ({ page }) => {
  await signIn(page, "/search");
  await page.getByRole("searchbox", { name: "Search", exact: true }).fill("Kasa");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByRole("heading", { name: "Recent searches" })).toBeVisible();
  await page.locator(".recent .pill button", { hasText: "Kasa" }).click();
  await expect(page.locator(".top-card h2")).toHaveText("Kasa Kaan");
});

test("offers albums you don't have and fetches them through Lidarr", async ({ page }) => {
  await signIn(page, "/search?q=harbor");
  await expect(page.getByRole("heading", { name: "Not in your library yet" })).toBeVisible();
  const card = page.locator(".get-card", { hasText: "Harbor Lights" });
  await expect(card).toContainText("Neon Harbor, 2024");
  await card.getByRole("button", { name: "Get album" }).click();
  await expect(card.getByText("Searching indexers")).toBeVisible();
  await expect(card.getByText(/Downloading, \d+%/)).toBeVisible({ timeout: 15_000 });
});

test("fetches a single song from Soulseek and follows it on the Requests page", async ({ page }) => {
  await signIn(page, "/search?q=undertow");
  await page.getByRole("group", { name: "Filter results" }).getByRole("button", { name: "Get music", exact: true }).click();
  const card = page.locator(".get-card", { hasText: "Undertow" });
  await expect(card).toContainText("Glass Harbor, Tidal, 3:32");
  await card.getByRole("button", { name: "Get song" }).click();
  await page.getByRole("button", { name: "Requests" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
  const row = page.locator(".req-row", { hasText: "Undertow" });
  await expect(row).toContainText("Song, Glass Harbor");
  await expect(row).toContainText("In your library", { timeout: 20_000 });
  await row.getByRole("button", { name: "Remove Undertow from this list" }).click();
  await expect(row).toHaveCount(0);
});
