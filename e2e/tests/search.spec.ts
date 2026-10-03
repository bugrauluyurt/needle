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
  await page.locator("nav.side").getByRole("button", { name: "Search in your library" }).click();
  await expect(page).toHaveURL(/\/library/);
  const find = page.getByRole("searchbox", { name: "Search in your library" });
  await expect(find).toBeFocused();
  await find.fill("field");
  const results = page.locator(".library-page");
  await expect(results.getByText("Weightless Hours")).toBeVisible();
  await expect(results.getByText("Night Transit")).toHaveCount(0);
  await find.fill("zzzz");
  await expect(results.getByText("Nothing in your library matches “zzzz”.")).toBeVisible();
});

test("your library opens unfiltered, filters like search and lists every song", async ({ page }) => {
  await signIn(page, "/library");
  const chips = page.locator(".library-page").getByRole("group", { name: "Filter your library" });
  await expect(chips.getByRole("button")).toHaveText(["All", "Songs", "Albums", "Artists", "Playlists"]);
  await expect(chips.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  await chips.getByRole("button", { name: "Songs" }).click();
  await expect(page.locator(".library-page .tr").first()).toBeVisible();
  await page.getByRole("searchbox", { name: "Search in your library" }).fill("harbor");
  await chips.getByRole("button", { name: "All" }).click();
  await expect(page.locator(".library-page .top-card h2")).toHaveText("Neon Harbor");
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

test("sorts focused library song results by release date in both directions", async ({ page }) => {
  await signIn(page, "/search?q=neon");
  await page.getByRole("button", { name: "Show all Songs in your library", exact: true }).click();
  await expect(page).toHaveURL(/source=library/);
  await page.getByRole("button", { name: /^Sort: Most relevant/ }).click();
  await page.getByRole("menuitemradio", { name: "Release date", exact: true }).click();

  const releaseDates = page.locator(".tr .col");
  await expect(releaseDates.first()).toBeVisible();
  const newestYears = (await releaseDates.allTextContents()).map((releaseDate) => Number(releaseDate));
  expect(newestYears.length).toBeGreaterThan(10);
  expect(newestYears).toEqual([...newestYears].sort((leftYear, rightYear) => rightYear - leftYear));
  expect(new Set(newestYears).size).toBeGreaterThan(1);

  await page.getByRole("button", { name: /^Sort: Release date, descending/ }).click();
  await page.getByRole("menuitemradio", { name: "Release date", exact: true }).click();
  await page.keyboard.press("Escape");
  const oldestYears = (await releaseDates.allTextContents()).map((releaseDate) => Number(releaseDate));
  expect(oldestYears).toEqual([...newestYears].sort((leftYear, rightYear) => leftYear - rightYear));

  await page.getByRole("button", { name: /^Sort: Release date, ascending/ }).click();
  await page.getByRole("menuitemradio", { name: "Most played", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Sort: Most played, descending/ })).toBeVisible();
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
  await page
    .getByRole("group", { name: "Filter results" })
    .getByRole("button", { name: "Get music", exact: true })
    .click();
  const card = page.locator(".get-card", { hasText: "Undertow" });
  await expect(card).toContainText("Glass Harbor, Tidal, 3:32");
  await card.getByRole("button", { name: "Get song" }).click();
  await page.getByRole("button", { name: "Requests" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
  const row = page.locator(".requests-page > .req-list .req-row", { hasText: "Undertow" });
  await expect(row).toContainText("Song, Glass Harbor");
  await expect(row).toContainText("In your library", { timeout: 20_000 });
  await row.getByRole("button", { name: "Remove Undertow from this list" }).click();
  await expect(row).toHaveCount(0);
});

test("desktop search keeps focus after committing and records the query", async ({ page }) => {
  await signIn(page, "/search");
  const search = page.getByRole("searchbox", { name: "Search", exact: true });
  await search.fill("neon");
  await search.press("Enter");
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("neon");
  await expect(page.locator(".top-card h2")).toHaveText("Neon Harbor");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.locator(".recent .pill button", { hasText: "neon" })).toBeVisible();
});
