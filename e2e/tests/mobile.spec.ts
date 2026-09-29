import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";

test("moves between tabs and plays from the mini player", async ({ page }) => {
  await signIn(page);
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link", { name: "Home" })).toHaveClass(/on/);
  await tabs.getByRole("link", { name: "Library" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your library" })).toBeVisible();
  await page.locator(".lib-item", { hasText: "Late night drive" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Late night drive" })).toBeVisible();
  await page.locator(".tr").first().tap();
  const mini = page.locator(".miniplayer");
  await expect(mini).toBeVisible();

  await mini.getByRole("button", { name: "Open now playing" }).tap();
  const sheet = page.getByRole("dialog", { name: "Now playing" });
  await expect(sheet.getByText("Playing from playlist")).toBeVisible();
  await sheet.getByRole("button", { name: "Next" }).tap();
  await sheet.getByRole("button", { name: "Queue" }).tap();
  await expect(sheet.getByText("Now playing")).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).tap();
  await sheet.getByRole("button", { name: "Open lyrics" }).tap();
  await expect(sheet.locator(".lyrics")).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).tap();
  await sheet.getByRole("button", { name: "Close" }).tap();
  await expect(sheet).toBeHidden();
});

test("song options open as a sheet, and Go to album minimizes the player", async ({ page }) => {
  await signIn(page, "/library");
  await page.locator(".lib-item", { hasText: "Late night drive" }).click();
  await page.locator(".tr").first().tap();
  await page.locator(".miniplayer").getByRole("button", { name: "Open now playing" }).tap();
  const player = page.getByRole("dialog", { name: "Now playing" });
  await player.getByRole("button", { name: "More options" }).tap();

  const sheet = page.locator(".action-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".as-quick button")).toHaveText(["Add to queue", "Play next", /Like/]);
  await sheet.getByRole("button", { name: "Add to playlist" }).tap();
  await expect(sheet.getByRole("textbox", { name: "Find a playlist" })).toBeVisible();
  await sheet.getByRole("button", { name: "Back" }).tap();
  await sheet.getByRole("button", { name: "Go to album" }).tap();

  await expect(sheet).toBeHidden();
  await expect(player).toBeHidden();
  await expect(page).toHaveURL(/\/album\//);
});

test("searches with the mobile search box", async ({ page }) => {
  await signIn(page, "/search");
  await page.getByRole("searchbox", { name: "Search", exact: true }).fill("okto");
  await expect(page.locator(".top-card h2")).toHaveText("Okto Quartet");
});

test("the search button opens Search with the field focused", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Search", exact: true }).tap();
  await expect(page).toHaveURL(/\/search/);
  await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Search", exact: true })).toHaveCount(0);
});

test("shows the You tab with install steps for iPhone", async ({ page }) => {
  await signIn(page, "/you");
  await expect(page.getByText("Put Needle on your home screen")).toBeVisible();
  await page.getByRole("link", { name: /Your listening/ }).tap();
  await expect(page.locator(".stat-lede")).toContainText("hours of music");
});
