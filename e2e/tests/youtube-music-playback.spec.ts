import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { bar, signIn } from "./helpers.ts";
import { mockYouTubeMusic } from "./youtube-music-mock.ts";

test("plays YouTube audio, moves through the queue, and stops when switched off", async ({ page }) => {
  const mock = await mockYouTubeMusic(page);
  const musicBytes = await readFile(new URL("../.library/Neon Harbor/Night Transit (2022)/01 - Night Transit.mp3", import.meta.url));
  const streamRequests: string[] = [];
  const localSongRequests: string[] = [];

  page.on("request", (request) => {
    const requestUrl = new URL(request.url());

    if (/\/rest\/(?:stream|scrobble|savePlayQueue)/.test(requestUrl.pathname) && requestUrl.searchParams.get("id")?.startsWith("ytm:")) localSongRequests.push(request.url());
  });

  await page.route("**/youtube-music/stream/**", (route) => {
    streamRequests.push(route.request().url());

    return route.fulfill({ body: musicBytes, contentType: "audio/mpeg" });
  });

  await signIn(page, "/youtube-music/album/MPRE_album");
  await page.locator(".actbar .bigplay").click();

  await expect(bar(page).getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(bar(page)).toContainText("YouTube Song 1");
  await expect.poll(() => streamRequests.length).toBeGreaterThan(0);
  await bar(page).getByRole("button", { name: "Next", exact: true }).click();

  await expect(bar(page)).toContainText("YouTube Song 2");

  const metadataSongs = page.locator(".tr");

  await metadataSongs.nth(1).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Add to playlist", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Account, signed in as admin/ }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await expect(bar(page).getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.getByRole("switch", { name: "Use YouTube Music in Needle", exact: true }).click();

  await expect.poll(() => mock.enabled).toBe(false);
  await expect(bar(page).getByRole("button", { name: "Play", exact: true })).toBeVisible();

  const requestCount = streamRequests.length;

  await bar(page).getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator("aside.right").getByText("YouTube Music is switched off or unavailable in Needle.", { exact: true })).toBeVisible();

  expect(streamRequests).toHaveLength(requestCount);
  expect(localSongRequests).toHaveLength(0);
});

test("offers an external link after playback fails without resolving the next track", async ({ page }) => {
  await mockYouTubeMusic(page);
  const streamRequests: string[] = [];

  await page.route("**/youtube-music/stream/**", (route) => {
    streamRequests.push(route.request().url());

    return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "YouTube Music is unavailable" }) });
  });

  await signIn(page, "/youtube-music/album/MPRE_album");
  await page.locator(".actbar .bigplay").click();

  await expect(page.locator("aside.right").getByText("Playback stopped", { exact: true })).toBeVisible();
  await expect(page.locator("aside.right").getByRole("link", { name: "Open in YouTube Music", exact: true })).toHaveAttribute("href", "https://music.youtube.com/watch?v=video000001");
  await expect(bar(page)).toContainText("YouTube Song 1");

  expect(streamRequests.every((requestUrl) => new URL(requestUrl).pathname.endsWith("video000001"))).toBe(true);
});
