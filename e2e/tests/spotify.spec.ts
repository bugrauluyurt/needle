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
  await side.getByRole("button", { name: "Spotify", exact: true }).click();
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
  await expect(side.getByText("Artists you like here, or follow on Spotify, show up here.")).toBeVisible();
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
  await filters.getByRole("button", { name: "Get albums", exact: true }).click();
  await expect(library).toHaveCount(0);
  await expect(spotify).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Not in your library yet" })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search" }).fill("zzzz");
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
