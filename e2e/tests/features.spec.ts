import { expect, test } from "@playwright/test";
import { bar, openAlbum, playContext, position, signIn } from "./helpers.ts";

test("follows the lyrics line by line and seeks when a line is clicked", async ({ page }) => {
  await signIn(page);
  await openAlbum(page, "Afterglow Avenue");
  await playContext(page);
  await bar(page).getByRole("button", { name: "Lyrics" }).click();
  await expect(page).toHaveURL(/\/lyrics$/);
  await expect(page.getByText("Lyrics, timed, from the song’s file")).toBeVisible();
  await expect(page.locator(".lyric.now")).toHaveText("Streetlights hum a quiet tune", { timeout: 8_000 });
  const seekableLyric = page.getByRole("button", { name: "Every story fades by noon" });

  await expect(seekableLyric).toHaveJSProperty("tagName", "BUTTON");
  await seekableLyric.click();
  await expect(page.locator(".lyric.now")).toHaveText("Every story fades by noon");
  expect(await position(page)).toBeGreaterThanOrEqual(18);

  await bar(page).getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("No lyrics for this song")).toBeVisible();
});

test("shows listening stats for each period", async ({ page }) => {
  await signIn(page, "/stats");
  await expect(page.locator(".stat-lede")).toContainText(/\d+(?:\.\d+)? (?:minutes?|hours?) of music/);
  await expect(page.locator(".stat-box", { hasText: "Top artists" }).locator(".rank")).toHaveCount(5);
  await expect(page.locator(".hours i")).toHaveCount(24);
  await page.getByRole("button", { name: "All time" }).click();
  await expect(page.locator(".stat-lede")).toContainText("so far");
});

test("plays internet radio through the Needle server", async ({ page }) => {
  await signIn(page, "/radio");
  const station = page.locator(".station", { hasText: "Test Signal" });
  await station.getByRole("button", { name: "Play Test Signal" }).click();
  await expect(bar(page).locator(".np-t")).toHaveText("Test Signal");
  await expect(bar(page).locator(".live")).toBeVisible();
  await expect(station).toHaveClass(/on/);
  await station.getByRole("button", { name: "Stop Test Signal" }).click({ timeout: 10_000 });
  await expect(station.getByRole("button", { name: "Play Test Signal" })).toBeVisible();
});

test("starts an artist radio", async ({ page }) => {
  await signIn(page);
  await openAlbum(page, "Night Transit");
  await page.locator(".meta-artist").click();
  await expect(page.getByRole("heading", { level: 1, name: "Neon Harbor" })).toBeVisible();
  await expect(page.locator(".artist-page h2").first()).toHaveText("Songs");
  await expect(page.getByRole("button", { name: /^Sort: Most played, descending/ })).toBeVisible();
  await expect(page.locator(".artist-page .tr")).toHaveCount(10);
  await page.getByRole("button", { name: "Artist radio" }).click();
  await expect(bar(page).locator(".np-t")).not.toHaveText("Nothing playing");
});

test("downloads an album and plays it with no connection", async ({ page, context }) => {
  await signIn(page);
  await openAlbum(page, "Salt & Signal");
  await page.locator(".actbar").getByRole("button", { name: "Download" }).click();
  await expect(page.getByRole("button", { name: "Remove download" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".tr .dlmark")).toHaveCount(5);

  await page.goto("/downloads");
  await expect(page.locator(".dl-row", { hasText: "Salt & Signal" })).toContainText("5 songs");
  await context.setOffline(true);
  await page
    .locator(".dl-row", { hasText: "Salt & Signal" })
    .getByRole("button", { name: "Play Salt & Signal" })
    .click();
  await expect(bar(page).locator(".np-t")).toHaveText("Salt & Signal");
  await expect.poll(() => position(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  await context.setOffline(false);

  await page
    .locator(".dl-row", { hasText: "Salt & Signal" })
    .getByRole("button", { name: "Remove Salt & Signal from this device" })
    .click();
  await expect(page.locator(".dl-row", { hasText: "Salt & Signal" })).toHaveCount(0);
});

test("changes settings and keeps them", async ({ page }) => {
  await signIn(page, "/settings");
  await page.getByRole("radio", { name: "Per song" }).click();
  await page.getByRole("switch", { name: "Colour from album art" }).click();
  await page.getByLabel("Device name").fill("Test bench");
  await page.getByLabel("Device name").press("Enter");
  await page.reload();
  await expect(page.getByRole("radio", { name: "Per song" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("switch", { name: "Colour from album art" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByLabel("Device name")).toHaveValue("Test bench");
  await expect(page.getByRole("button", { name: "Connect Spotify" })).toBeDisabled();
});

test("supports page zoom and keyboard radio navigation", async ({ page }) => {
  await signIn(page, "/settings");

  const viewportContent = await page.locator('meta[name="viewport"]').getAttribute("content");
  const disabledNormalization = page.getByRole("radio", { name: "Off", exact: true });
  const perSongNormalization = page.getByRole("radio", { name: "Per song", exact: true });
  const perAlbumNormalization = page.getByRole("radio", { name: "Per album", exact: true });

  expect(viewportContent).not.toContain("maximum-scale");
  expect(viewportContent).not.toContain("user-scalable=no");
  await disabledNormalization.focus();
  await disabledNormalization.press("ArrowRight");
  await expect(perSongNormalization).toBeFocused();
  await expect(perSongNormalization).toHaveAttribute("aria-checked", "true");
  await perSongNormalization.press("End");
  await expect(perAlbumNormalization).toBeFocused();
  await expect(perAlbumNormalization).toHaveAttribute("aria-checked", "true");
  await perAlbumNormalization.press("Home");
  await expect(disabledNormalization).toBeFocused();
  await expect(disabledNormalization).toHaveAttribute("aria-checked", "true");
});

test("admins see what the server can reach", async ({ page }) => {
  await signIn(page, "/settings");
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();
  const connectionState = (name: string) =>
    page
      .locator(".set-row")
      .filter({ has: page.getByText(name, { exact: true }) })
      .locator(".conn-state");
  for (const name of ["Navidrome", "Lidarr (albums)", "slskd (single songs)", "Song folders"]) {
    await expect(connectionState(name)).toHaveText("Working");
  }
  await expect(connectionState("Spotify")).toHaveText("Off");
});
