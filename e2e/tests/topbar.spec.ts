import { expect, test } from "@playwright/test";
import { openAlbum, signIn } from "./helpers.ts";

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

test("shows the album's name and cover in the top bar after scrolling, moving search aside", async ({ page }) => {
  await signIn(page);
  await openAlbum(page, "Afterglow Avenue");
  const top = page.locator(".topbar");
  const name = top.locator(".top-name");
  const search = top.locator(".top-search .sf");
  const left = async () => (await search.boundingBox())?.x ?? 0;
  const centred = await left();
  await expect(name).toBeHidden();

  const main = page.locator("#main");
  await main.evaluate((m) => m.scrollTo(0, m.scrollHeight));
  await expect(name).toHaveText("Afterglow Avenue");
  await expect(name).toBeVisible();
  await expect(top.locator(".top-cover img")).toBeVisible();
  await expect.poll(left).toBeGreaterThan(centred + 40);

  await main.evaluate((m) => m.scrollTo(0, 0));
  await expect(name).toBeHidden();
  await expect.poll(left).toBeCloseTo(centred, 0);
});
