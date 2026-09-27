import { expect, test } from "@playwright/test";
import { openAlbum, playContext, signIn } from "./helpers.ts";

test("likes a song and finds it in Liked songs", async ({ page }) => {
  await signIn(page);
  await openAlbum(page, "Salt & Signal");
  const row = page.locator(".tr", { hasText: "Lighthouse Keeper" });
  await row.hover();
  await row.getByRole("button", { name: "Add Lighthouse Keeper to liked songs" }).click();
  await expect(row.getByRole("button", { name: "Remove Lighthouse Keeper from liked songs" })).toBeVisible();

  await page.getByRole("link", { name: /Liked songs/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Liked songs" })).toBeVisible();
  await expect(page.locator(".tr", { hasText: "Lighthouse Keeper" })).toBeVisible();
  await page.getByLabel("Find in liked songs").fill("lighthouse");
  await expect(page.locator(".tr")).toHaveCount(1);

  await page.locator(".tr", { hasText: "Lighthouse Keeper" }).getByRole("button", { name: "Remove Lighthouse Keeper from liked songs" }).click();
  await expect(page.locator(".tr")).toHaveCount(0);
});

test("saves an album to the library and shows it in the sidebar", async ({ page }) => {
  await signIn(page);
  await openAlbum(page, "Pulse Theory");
  await page.getByRole("button", { name: "Add to your library" }).click();
  await expect(page.locator(".lib-item", { hasText: "Pulse Theory" })).toBeVisible();
  await page.getByRole("button", { name: "Albums" }).first().click();
  await expect(page.locator(".side .lib-item", { hasText: "Late night drive" })).toHaveCount(0);
  await page.getByRole("button", { name: "Albums" }).first().click();
  await page.getByRole("button", { name: "Remove from your library" }).click();
  await expect(page.locator(".side .lib-item", { hasText: "Pulse Theory" })).toHaveCount(0);
});

test("creates, fills, renames, reorders and deletes a playlist", async ({ page }) => {
  await signIn(page);
  await page.locator(".side").getByRole("button", { name: "Create playlist" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit details" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("Test drive");
  await dialog.getByLabel("Description").fill("Made by the end-to-end tests");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Test drive" })).toBeVisible();
  await expect(page.getByText("Made by the end-to-end tests")).toBeVisible();

  for (const [album, song] of [["Night Transit", "Overpass"], ["Night Transit", "Arrivals"]] as const) {
    await openAlbum(page, album);
    await page.locator(".tr", { hasText: song }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Add to playlist" }).hover();
    await page.getByRole("menuitem", { name: "Test drive" }).click();
    await expect(page.getByText("Added to Test drive")).toBeVisible();
  }

  await page.locator(".side .lib-item", { hasText: "Test drive" }).click();
  const rows = page.locator(".tr .name");
  await expect(rows).toHaveText(["Overpass", "Arrivals"]);
  await page.locator(".tr", { hasText: "Arrivals" }).dragTo(page.locator(".tr", { hasText: "Overpass" }));
  await expect(rows).toHaveText(["Arrivals", "Overpass"]);
  await page.reload();
  await expect(rows).toHaveText(["Arrivals", "Overpass"]);

  await page.locator(".tr", { hasText: "Overpass" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove from this playlist" }).click();
  await expect(rows).toHaveText(["Arrivals"]);

  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByRole("dialog", { name: "Edit details" }).getByRole("button", { name: "Delete playlist" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.locator(".lib-item", { hasText: "Test drive" })).toHaveCount(0);
});

test("finds songs in a playlist and sorts them", async ({ page }) => {
  await signIn(page);
  await page.locator(".side .lib-item", { hasText: "Late night drive" }).click();
  const rows = page.locator(".tr .name");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(5);
  await page.getByRole("button", { name: /Custom order/ }).click();
  await page.getByRole("menuitem", { name: "Title" }).click();
  const titles = await rows.allTextContents();
  expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
  await page.getByRole("button", { name: "Find in playlist" }).click();
  await page.getByLabel("Find in playlist").fill(titles[0] ?? "");
  await expect(rows).toHaveCount(1);
});

test("plays a mix from Home and a genre", async ({ page }) => {
  await signIn(page);
  const mix = page.locator(".card", { hasText: "Synthwave" }).first();
  await mix.hover();
  await mix.getByRole("button", { name: "Play Synthwave" }).click();
  await expect(page.locator("footer.bar .np-t")).not.toHaveText("Nothing playing");
  await page.goto("/genre/Jazz");
  await expect(page.getByRole("heading", { level: 1, name: "Jazz" })).toBeVisible();
  await playContext(page);
  await expect(page.locator("footer.bar .np-a")).toHaveText("Okto Quartet");
});
