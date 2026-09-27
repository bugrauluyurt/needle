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
  await page.getByRole("searchbox", { name: "Search" }).fill("neon");
  await expect(page).toHaveURL(/q=neon/);
  await expect(page.locator(".top-card h2")).toHaveText("Neon Harbor");
  await expect(page.locator(".songs-mini .song-mini")).toHaveCount(4);
  const filters = page.getByRole("group", { name: "Filter results" });
  await filters.getByRole("button", { name: "Songs", exact: true }).click();
  await expect(page.locator(".tr").first()).toBeVisible();
  await filters.getByRole("button", { name: "Artists", exact: true }).click();
  await expect(page.locator(".card", { hasText: "Neon Harbor" })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search" }).fill("zzzz nothing");
  await expect(page.getByText("No artists in your library match “zzzz nothing”.")).toBeVisible();
});

test("remembers recent searches", async ({ page }) => {
  await signIn(page, "/search");
  await page.getByRole("searchbox", { name: "Search" }).fill("Kasa");
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
