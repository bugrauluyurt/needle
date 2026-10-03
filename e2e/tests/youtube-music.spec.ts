import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";
import { mockYouTubeMusic } from "./youtube-music-mock.ts";

test("shows YouTube Music on Home and filters it in Your library", async ({ page }) => {
  await mockYouTubeMusic(page);
  await signIn(page);

  await expect(page.getByRole("heading", { name: "Your YouTube Music playlists" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Albums you saved on YouTube Music" })).toBeVisible();

  const sidebar = page.locator("nav.side");

  await sidebar.getByRole("button", { name: /^Show and sort/ }).click();
  await page.getByRole("menuitemradio", { name: "YouTube Music", exact: true }).click();

  await expect(sidebar.locator(".lib-item")).toHaveCount(4);
  await expect(sidebar.locator(".lib-item", { hasText: "Liked on YouTube Music" })).toContainText("3 songs");

  await page.goto("/library");
  await page
    .getByRole("group", { name: "Filter your library" })
    .getByRole("button", { name: "Songs", exact: true })
    .click();

  await expect(page.locator(".tr")).toHaveCount(3);
  await expect(page.locator(".tr").getByRole("img", { name: "From YouTube Music", exact: true })).toHaveCount(3);
});

test("searches YouTube Music independently and expands a category on demand", async ({ page }) => {
  const mock = await mockYouTubeMusic(page, { songCount: 45 });

  await signIn(page, "/search?q=neon");

  await expect(page.getByRole("region", { name: "In your library", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "On YouTube Music", exact: true }).locator(".song-mini")).toHaveCount(
    4,
  );

  await page.getByRole("button", { name: "Show all Songs on YouTube Music", exact: true }).click();

  await expect(page).toHaveURL(/source=youtubeMusic/);
  await expect(page.locator(".tr")).toHaveCount(20);

  await page.getByRole("button", { name: "Load more", exact: true }).click();

  await expect(page.locator(".tr")).toHaveCount(40);

  expect(
    mock.requests
      .filter((request) => request.path === "/search" && request.kind === "songs")
      .map((request) => request.limit),
  ).toEqual([20, 40]);

  await page.getByRole("searchbox", { name: "Search", exact: true }).fill("zzzz");

  await expect(
    page
      .getByRole("region", { name: "On YouTube Music", exact: true })
      .getByText("YouTube Music found no results for “zzzz”."),
  ).toBeVisible();
});

test("opens album and artist pages, saves albums and follows artists", async ({ page }) => {
  const mock = await mockYouTubeMusic(page);

  await signIn(page, "/youtube-music/album/MPRE_album");

  await expect(page.getByRole("heading", { level: 1, name: "Glass Hours on YouTube" })).toBeVisible();
  await expect(page.locator(".tr")).toHaveCount(3);

  await page.getByRole("button", { name: "Remove from your YouTube Music library", exact: true }).click();

  await expect(page.getByRole("button", { name: "Save to your YouTube Music library", exact: true })).toBeVisible();

  await page.locator(".meta-artist").click();

  await expect(page.getByRole("heading", { level: 1, name: "Lumen Drift" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Singles and EPs", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Following", exact: true }).click();

  await expect(page.getByRole("button", { name: "Follow", exact: true })).toBeVisible();

  expect(mock.writes).toEqual(["/albums/MPRE_album/saved:false", "/artists/UC_artist/follow:false"]);
});

test("keeps YouTube playlists read only and liked song dates truthful", async ({ page }) => {
  await mockYouTubeMusic(page);
  await signIn(page, "/youtube-music/playlist/PL_playlist");

  await expect(page.getByRole("heading", { level: 1, name: "Night bus home" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in YouTube Music", exact: true })).toHaveAttribute(
    "href",
    "https://music.youtube.com/playlist?list=PL_playlist",
  );

  await page.locator(".tr").first().click({ button: "right" });

  await expect(page.getByRole("menuitem", { name: "Remove from this playlist", exact: true })).toHaveCount(0);

  await page.goto("/youtube-music/liked");

  await expect(page.getByRole("heading", { level: 1, name: "Liked on YouTube Music" })).toBeVisible();
  await expect(page.getByText("Invalid Date", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Date added", exact: true })).toHaveCount(0);
});

test("retains local search when YouTube Music is paused", async ({ page }) => {
  await mockYouTubeMusic(page, { searchFailure: 429 });
  await signIn(page, "/search?q=neon");

  await expect(page.getByRole("region", { name: "In your library", exact: true }).locator(".top-card h2")).toHaveText(
    "Neon Harbor",
  );
  await expect(page.getByText("YouTube Music requests are paused", { exact: true })).toBeVisible();

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Recently added", exact: true })).toBeVisible();
});

test("makes no YouTube Music requests while switched off", async ({ page }) => {
  const mock = await mockYouTubeMusic(page, { enabled: false });

  await signIn(page, "/search?q=neon");

  await expect(page.getByRole("region", { name: "In your library", exact: true }).locator(".top-card h2")).toHaveText(
    "Neon Harbor",
  );
  await expect(page.getByRole("region", { name: "On YouTube Music", exact: true })).toHaveCount(0);

  expect(mock.requests).toHaveLength(0);

  await page.goto("/youtube-music/album/MPRE_album");

  await expect(page.getByRole("heading", { name: "YouTube Music is switched off", exact: true })).toBeVisible();

  expect(mock.requests).toHaveLength(0);
});

test("connects through the Google device flow and switches the source off", async ({ page }) => {
  const mock = await mockYouTubeMusic(page, { connected: false });

  await signIn(page, "/settings");
  await page.getByRole("button", { name: "Connect", exact: true }).click();

  await expect(page.getByText("TEST-CODE", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Google", exact: true })).toHaveAttribute(
    "href",
    "https://www.google.com/device",
  );
  await expect(page.getByRole("switch", { name: "Use YouTube Music in Needle", exact: true })).toBeVisible();

  await page.getByRole("switch", { name: "Use YouTube Music in Needle", exact: true }).click();

  await expect.poll(() => mock.enabled).toBe(false);

  const metadataRequests = mock.requests.filter((request) => !["/enabled", "/login"].includes(request.path)).length;

  await page.goto("/search?q=neon");
  await expect(page.getByRole("region", { name: "In your library", exact: true })).toBeVisible();

  expect(mock.requests.filter((request) => !["/enabled", "/login"].includes(request.path))).toHaveLength(
    metadataRequests,
  );
});

test("rolls back a rejected album save and renders missing artwork", async ({ page }) => {
  await mockYouTubeMusic(page, { missingArt: true, denyWrites: true });
  await signIn(page, "/youtube-music/album/MPRE_album");

  await expect(page.locator(".hero-art .art")).toBeVisible();

  await page.getByRole("button", { name: "Remove from your YouTube Music library", exact: true }).click();

  await expect(page.getByRole("button", { name: "Remove from your YouTube Music library", exact: true })).toBeVisible();
  await expect(
    page.getByText("YouTube Music didn’t save that change. Try again or reconnect in Settings.", { exact: true }),
  ).toBeVisible();
});
