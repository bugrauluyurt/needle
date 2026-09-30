import { expect, test } from "@playwright/test";
import { bar, signIn } from "./helpers.ts";
import { mockSpotify } from "./spotify-mock.ts";

test("shows the Spotify library next to your own", async ({ page }) => {
  await mockSpotify(page);
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Your Spotify playlists" })).toBeVisible();
  await expect(page.locator(".card", { hasText: "Road trip" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Albums you saved on Spotify" })).toBeVisible();

  const side = page.locator("nav.side");
  await side.getByRole("button", { name: /^Show and sort/ }).click();
  await page.getByRole("menuitemradio", { name: "Spotify" }).click();
  await expect(side.locator(".lib-item")).toHaveCount(5);
  await expect(side.locator(".lib-item", { hasText: "Liked on Spotify" })).toContainText("3 songs");
  await side.locator(".lib-item", { hasText: "Liked on Spotify" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Liked on Spotify" })).toBeVisible();
  await expect(page.locator(".tr")).toHaveCount(3);
});

test("opens Spotify playlists, albums and artists", async ({ page }) => {
  await mockSpotify(page);
  await signIn(page, "/spotify/playlist/p1");
  await expect(page.getByRole("heading", { level: 1, name: "Road trip" })).toBeVisible();
  await expect(page.locator(".tr")).toHaveCount(2);

  await page.goto("/spotify/playlist/p2");
  await expect(page.getByRole("heading", { name: "Spotify keeps this playlist’s songs to itself" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in Spotify" }).first()).toHaveAttribute("href", "https://open.spotify.com/playlist/p2");

  await page.goto("/spotify/album/al1");
  await expect(page.getByRole("heading", { level: 1, name: "Glass Hours" })).toBeVisible();
  await expect(page.locator(".tr")).toHaveCount(3);
  await page.locator(".meta-artist", { hasText: "Lumen Drift" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lumen Drift" })).toBeVisible();
  await expect(page.locator(".card", { hasText: "Glass Hours" })).toBeVisible();
});

test("lists followed artists and follows or unfollows them", async ({ page }) => {
  const mock = await mockSpotify(page);
  await signIn(page);
  const side = page.locator("nav.side");
  await side.getByRole("button", { name: "Artists", exact: true }).click();
  await expect(side.locator(".lib-item", { hasText: "Lumen Drift" })).toContainText("Artist you follow on Spotify");
  await side.locator(".lib-item", { hasText: "Lumen Drift" }).click();
  await page.getByRole("button", { name: "Following" }).click();
  await expect(page.getByRole("button", { name: "Follow", exact: true })).toBeVisible();
  await expect(side.locator(".lib-item", { hasText: "Lumen Drift" })).toHaveCount(0);
  await expect.poll(() => mock.saved).toEqual(["DELETE spotify:artist:ar1"]);
});

test("starts a radio from a Spotify song", async ({ page }) => {
  const mock = await mockSpotify(page);
  await signIn(page, "/spotify/album/al1");
  await page.locator(".tr", { hasText: "Glass Song 2" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Start radio from this song" }).click();
  await expect.poll(() => mock.plays.length).toBe(1);
  expect(mock.plays[0]?.uris).toEqual(["spotify:track:t2"]);
  await expect(page.locator(".rp-card, .bar").getByText("Glass Song 2").first()).toBeVisible();
});

test("searches your library and Spotify in separate sections, and the filters apply to both", async ({ page }) => {
  await mockSpotify(page);
  await signIn(page, "/search?q=neon");
  const library = page.getByRole("region", { name: "In your library", exact: true });
  const spotify = page.getByRole("region", { name: "On Spotify", exact: true });
  await expect(library.locator(".top-card h2")).toHaveText("Neon Harbor");
  await expect(spotify.locator(".song-mini")).toHaveCount(3);
  await expect(spotify.locator(".card", { hasText: "Glass Hours" })).toBeVisible();

  const filters = page.getByRole("group", { name: "Filter results" });
  await filters.getByRole("button", { name: "Songs", exact: true }).click();
  await expect(library.locator(".tr").first()).toBeVisible();
  await expect(spotify.locator(".tr")).toHaveCount(3);
  await filters.getByRole("button", { name: "Playlists", exact: true }).click();
  await expect(library.getByText("No playlists in your library match “neon”.")).toBeVisible();
  await expect(spotify.locator(".card", { hasText: "Chill Hits" })).toBeVisible();
  await filters.getByRole("button", { name: "Get music", exact: true }).click();
  await expect(library).toHaveCount(0);
  await expect(spotify).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Not in your library yet" })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search", exact: true }).fill("zzzz");
  await filters.getByRole("button", { name: "All", exact: true }).click();
  await expect(library.getByText("Nothing in your library matches “zzzz”.")).toBeVisible();
  await expect(spotify.getByText("Spotify found no results for “zzzz”.")).toBeVisible();
});

test("plays Spotify songs through the Web Playback SDK and moves on when one ends", async ({ page }) => {
  const mock = await mockSpotify(page);
  await signIn(page, "/spotify/album/al1");
  await page.locator(".actbar .bigplay").click();
  await expect.poll(() => mock.plays.length).toBe(1);
  expect(mock.plays[0]).toEqual({ device: "dev1", uris: ["spotify:track:t1"] });
  await page.evaluate(() => (window as unknown as { __sdk: { emit: (s: unknown) => void } }).__sdk.emit({ paused: false, position: 1000, duration: 201_000, track_window: { current_track: { uri: "spotify:track:t1" }, previous_tracks: [] } }));
  await expect(bar(page)).toContainText("Glass Song 1");
  await expect(bar(page).getByRole("button", { name: "Pause" })).toBeVisible();

  await page.evaluate(() => (window as unknown as { __sdk: { emit: (s: unknown) => void } }).__sdk.emit({ paused: true, position: 0, duration: 201_000, track_window: { current_track: { uri: "spotify:track:t1" }, previous_tracks: [{ uri: "spotify:track:t1" }] } }));
  await expect.poll(() => mock.plays.length).toBe(2);
  expect(mock.plays[1]?.uris).toEqual(["spotify:track:t2"]);
  await expect(bar(page)).toContainText("Glass Song 2");

  await bar(page).getByRole("button", { name: "Remove from liked songs" }).click();
  await expect(bar(page).getByRole("button", { name: "Add to liked songs" })).toBeVisible();
  await expect.poll(() => mock.saved).toEqual(["DELETE spotify:track:t2"]);
});

test("hides Spotify and stops calling it while Spotify refuses requests", async ({ page }) => {
  await mockSpotify(page);
  let calls = 0;
  await page.route("https://api.spotify.com/v1/**", (route) => {
    calls += 1;
    return route.fulfill({ status: 429, headers: { "retry-after": "33000", "access-control-allow-origin": "*" }, json: { error: { status: 429, message: "Too many requests", reason: "QUOTA_EXCEEDED" } } });
  });
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Recently added" })).toBeVisible();
  await expect.poll(() => calls).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "Your Spotify playlists" })).toHaveCount(0);
  await expect(page.locator("nav.side .lib-item", { hasText: "Liked on Spotify" })).toHaveCount(0);
  const before = calls;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Recently added" })).toBeVisible();
  await page.goto("/search?q=glass");
  await expect(page.getByRole("region", { name: "In your library", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "On Spotify", exact: true })).toHaveCount(0);
  expect(calls).toBe(before);
});

test("never calls Spotify when it's switched off in Needle", async ({ page }) => {
  await mockSpotify(page);
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().startsWith("https://api.spotify.com/") || r.url().startsWith("https://sdk.scdn.co/")) calls += 1;
  });
  await page.route("**/api/capabilities", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()) as object, spotify: true, spotifyConnected: true, spotifyPlayback: true, spotifyEnabled: false } });
  });
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Recently added" })).toBeVisible();
  await page.goto("/search?q=glass");
  await expect(page.getByRole("region", { name: "In your library", exact: true })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("switch", { name: "Use Spotify in Needle" })).toHaveAttribute("aria-checked", "false");
  expect(calls).toBe(0);
});
