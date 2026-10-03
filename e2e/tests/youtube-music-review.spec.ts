import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";
import { mockYouTubeMusic } from "./youtube-music-mock.ts";

test("clears the previous Google account's persisted library after reconnect", async ({ page }) => {
  await mockYouTubeMusic(page, { reconnect: true, nextAccountName: "Another listener" });
  await signIn(page, "/youtube-music/liked");

  await expect(page.locator(".tr .name").first()).toHaveText("YouTube Song 1");

  await page.getByRole("button", { name: /Account, signed in as admin/ }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();

  await expect(page.getByText("Connected as Another listener", { exact: true })).toBeVisible();

  await page.locator("nav.side .lib-item", { hasText: "Liked on YouTube Music" }).click();

  await expect(page.locator(".tr .name").first()).toHaveText("Another listener YouTube Song 1");

  await page.reload();

  await expect(page.locator(".tr .name").first()).toHaveText("Another listener YouTube Song 1");
});

test("uses authoritative membership for artists and albums beyond the first hundred", async ({ page }) => {
  const mock = await mockYouTubeMusic(page, { libraryCount: 101 });

  await signIn(page, "/youtube-music/artist/UC_artist");

  await expect(page.getByRole("button", { name: "Following", exact: true })).toBeEnabled();

  await page.getByRole("button", { name: "Following", exact: true }).click();

  await expect(page.getByRole("button", { name: "Follow", exact: true })).toBeVisible();

  await page.goto("/youtube-music/album/MPRE_album");

  await expect(page.getByRole("button", { name: "Remove from your YouTube Music library", exact: true })).toBeEnabled();

  expect(mock.requests.filter((request) => request.path === "/albums").some((request) => request.limit === 3000)).toBe(true);
});

test("does not claim unknown album membership when the library exceeds its limit", async ({ page }) => {
  await mockYouTubeMusic(page, { libraryCount: 3001 });
  await signIn(page, "/youtube-music/album/MPRE_album");

  await expect(page.getByRole("button", { name: "YouTube Music saved status unavailable", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save to your YouTube Music library", exact: true })).toHaveCount(0);
});

test("shows a provider error in Library while local albums remain usable", async ({ page }) => {
  await mockYouTubeMusic(page, { libraryFailure: 502 });
  await signIn(page, "/library");

  await expect(page.locator("#main .yt-notice").getByText("YouTube Music didn’t answer", { exact: true })).toBeVisible();
  await expect(page.locator("#main .yt-notice").getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await expect(page.locator("#main .card", { hasText: "Night Transit" })).toBeVisible();
});

test("preserves alternate official Google verification addresses", async ({ page }) => {
  await mockYouTubeMusic(page, { connected: false, verificationUrl: "https://accounts.google.com/device-verification" });
  await signIn(page, "/settings");
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(page.getByRole("link", { name: "Open Google", exact: true })).toHaveAttribute("href", "https://accounts.google.com/device-verification");
});

test("rejects an external Google verification address", async ({ page }) => {
  await mockYouTubeMusic(page, { connected: false, verificationUrl: "https://example.com/device" });
  await signIn(page, "/settings");
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(page.getByRole("alert")).toHaveText("Google sign-in returned an unexpected address. Try again.");
  await expect(page.getByRole("link", { name: "Open Google", exact: true })).toHaveCount(0);
});
