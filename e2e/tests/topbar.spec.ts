import { expect, test } from "@playwright/test";
import { bar, openAlbum, signIn } from "./helpers.ts";

test("opens search from the top bar on any page", async ({ page }) => {
  await signIn(page);
  await page.locator(".topbar").getByRole("searchbox", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/search/);
  await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toBeFocused();
});

test("the slash key opens search with the field focused", async ({ page }) => {
  await signIn(page, "/stats");
  await page.keyboard.press("/");
  await expect(page).toHaveURL(/\/search/);
  const field = page.getByRole("searchbox", { name: "Search", exact: true });
  await expect(field).toBeFocused();

  await field.fill("neon");
  await expect(page).toHaveURL(/q=neon/);
  await field.blur();
  await page.keyboard.press("/");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("neon");
});

test("shows the album's name and a play button in the top bar after scrolling", async ({ page }) => {
  await signIn(page);
  await openAlbum(page, "Afterglow Avenue");
  const top = page.locator(".topbar");
  const play = top.getByRole("button", { name: "Play Afterglow Avenue" });
  await expect(play).toBeHidden();

  await page.locator("#main").evaluate((main) => main.scrollTo(0, main.scrollHeight));
  await expect(top.locator(".top-name")).toHaveText("Afterglow Avenue");
  await expect(top.locator(".top-name")).toBeVisible();
  await play.click();
  await expect(bar(page).locator(".np-t")).toHaveText("Afterglow Avenue");
  await expect(top.getByRole("button", { name: "Pause Afterglow Avenue" })).toBeVisible();
});
