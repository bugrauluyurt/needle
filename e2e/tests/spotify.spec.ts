import { expect, test } from "@playwright/test";
import { bar, openAlbum, signIn } from "./helpers.ts";
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
  await expect(page.getByRole("link", { name: "Open in Spotify" }).first()).toHaveAttribute(
    "href",
    "https://open.spotify.com/playlist/p2",
  );

  await page.goto("/spotify/album/al1");
  await expect(page.getByRole("heading", { level: 1, name: "Glass Hours" })).toBeVisible();
  await expect(page.locator(".tr")).toHaveCount(3);
  await expect(page.locator(".tr").getByRole("img", { name: "From Spotify", exact: true })).toHaveCount(3);
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
  await expect(
    spotify.locator(".card", { hasText: "Glass Hours" }).getByRole("img", { name: "From Spotify", exact: true }),
  ).toBeVisible();
  await expect(
    library.locator(".card", { hasText: "Night Transit" }).getByRole("img", { name: "From your library", exact: true }),
  ).toBeVisible();

  const filters = page.getByRole("group", { name: "Filter results" });
  await filters.getByRole("button", { name: "Songs", exact: true }).click();
  await expect(library.locator(".tr").first()).toBeVisible();
  await expect(spotify.locator(".tr")).toHaveCount(3);
  await expect(spotify.locator(".tr").getByRole("img", { name: "From Spotify", exact: true })).toHaveCount(3);
  await expect(
    library.locator(".tr").first().getByRole("img", { name: "From your library", exact: true }),
  ).toBeVisible();
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

test("shows Spotify artist songs before releases and expands them on demand", async ({ page }) => {
  const mock = await mockSpotify(page, { searchSongCount: 23 });
  await signIn(page, "/spotify/artist/ar1");
  await expect(page.locator(".artist-page h2").first()).toHaveText("Songs");
  await expect(page.locator(".tr .name")).toHaveText(
    Array.from({ length: 10 }, (_, songIndex) => `Glass Song ${songIndex + 1}`),
  );
  const songSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: "Songs", exact: true }) });
  await songSection.getByRole("link", { name: "Show all", exact: true }).click();
  await expect(page).toHaveURL(/section=songs/);
  await expect(page.getByRole("heading", { level: 2, name: "Albums", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(page.locator(".tr")).toHaveCount(20);
  expect(
    mock.searches
      .filter((searchRequest) => searchRequest.type === "track")
      .map((searchRequest) => searchRequest.offset),
  ).toEqual([0, 10]);
});

test("expands a compact Spotify artist album section without fetching ahead", async ({ page }) => {
  const mock = await mockSpotify(page, { artistAlbumCount: 13 });
  await signIn(page, "/spotify/artist/ar1");
  const albumCollection = page
    .locator(".collection")
    .filter({ has: page.getByRole("heading", { level: 2, name: "Albums", exact: true }) });
  await expect(albumCollection.locator(".card")).toHaveCount(6);
  expect(
    mock.artistReleaseRequests
      .filter((releaseRequest) => releaseRequest.group === "album")
      .map((releaseRequest) => releaseRequest.offset),
  ).toEqual([0]);
  await albumCollection.getByRole("link", { name: "Show all", exact: true }).click();
  await expect(page).toHaveURL(/section=albums/);
  await expect(page.locator(".card")).toHaveCount(10);
  await expect(page.getByRole("heading", { level: 2, name: "Songs", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(page.locator(".card")).toHaveCount(13);
  await expect(page.getByRole("button", { name: "Load more", exact: true })).toHaveCount(0);
  expect(
    mock.artistReleaseRequests
      .filter((releaseRequest) => releaseRequest.group === "album")
      .map((releaseRequest) => releaseRequest.offset),
  ).toEqual([0, 10]);
});

test("loads more Spotify search songs on demand without changing the first page", async ({ page }) => {
  const mock = await mockSpotify(page, { searchSongCount: 23 });
  await signIn(page, "/search?q=glass");
  await page.getByRole("button", { name: "Show all Songs on Spotify", exact: true }).click();
  await expect(page).toHaveURL(/source=spotify/);
  await expect(page.getByRole("region", { name: "In your library", exact: true })).toHaveCount(0);

  const songTitles = page.locator(".tr .name");
  const firstPageTitles = Array.from({ length: 10 }, (_, songIndex) => `Glass Song ${songIndex + 1}`);
  await expect(songTitles).toHaveText(firstPageTitles);
  expect(mock.searches.filter((searchRequest) => searchRequest.query === "glass")).toHaveLength(1);

  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(songTitles).toHaveText(Array.from({ length: 20 }, (_, songIndex) => `Glass Song ${songIndex + 1}`));
  expect(
    mock.searches
      .filter((searchRequest) => searchRequest.query === "glass")
      .map((searchRequest) => searchRequest.offset),
  ).toEqual([0, 10]);

  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(songTitles).toHaveCount(23);
  await expect(page.getByRole("button", { name: "Load more", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to all search results", exact: true }).click();
  await expect(page.getByRole("region", { name: "In your library", exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toHaveValue("glass");
});

test("discards a delayed Spotify page when the search query changes", async ({ page }) => {
  const mock = await mockSpotify(page, {
    searchSongCount: 23,
    delayedSearch: { query: "glass", offset: 10, milliseconds: 1_200 },
  });
  await signIn(page, "/search?q=glass");
  await page.getByRole("button", { name: "Show all Songs on Spotify", exact: true }).click();
  await expect(page.locator(".tr")).toHaveCount(10);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect
    .poll(() => mock.searches.some((searchRequest) => searchRequest.query === "glass" && searchRequest.offset === 10))
    .toBe(true);

  await page.getByRole("searchbox", { name: "Search", exact: true }).fill("zzzz");
  await expect(page).toHaveURL(/q=zzzz/);
  await expect(page.getByText(/Spotify found no (songs|results) for “zzzz”\./)).toBeVisible();
  await expect(page.locator(".tr")).toHaveCount(0);
  await page.waitForTimeout(1_200);
  await expect(page.locator(".tr")).toHaveCount(0);
  await expect(page.getByText("Glass Song 11", { exact: true })).toHaveCount(0);
});

test("plays Spotify songs through the Web Playback SDK and moves on when one ends", async ({ page }) => {
  const mock = await mockSpotify(page);
  await signIn(page, "/spotify/album/al1");
  await page.locator(".actbar .bigplay").click();
  await expect.poll(() => mock.plays.length).toBe(1);
  expect(mock.plays[0]).toEqual({ device: "dev1", uris: ["spotify:track:t1"] });
  await page.evaluate(() =>
    (window as unknown as { __sdk: { emit: (s: unknown) => void } }).__sdk.emit({
      paused: false,
      position: 1000,
      duration: 201_000,
      track_window: { current_track: { uri: "spotify:track:t1" }, previous_tracks: [] },
    }),
  );
  await expect(bar(page)).toContainText("Glass Song 1");
  await expect(bar(page).getByRole("button", { name: "Pause" })).toBeVisible();

  await page.evaluate(() =>
    (window as unknown as { __sdk: { emit: (s: unknown) => void } }).__sdk.emit({
      paused: true,
      position: 0,
      duration: 201_000,
      track_window: { current_track: { uri: "spotify:track:t1" }, previous_tracks: [{ uri: "spotify:track:t1" }] },
    }),
  );
  await expect.poll(() => mock.plays.length).toBe(2);
  expect(mock.plays[1]?.uris).toEqual(["spotify:track:t2"]);
  await expect(bar(page)).toContainText("Glass Song 2");

  await bar(page).getByRole("button", { name: "Remove from liked songs" }).click();
  await expect(bar(page).getByRole("button", { name: "Add to liked songs" })).toBeVisible();
  await expect.poll(() => mock.saved).toEqual(["DELETE spotify:track:t2"]);
});

test("keeps Spotify visible and explains the cooldown while requests are paused", async ({ page }) => {
  await mockSpotify(page);
  let calls = 0;
  await page.route("https://api.spotify.com/v1/**", (route) => {
    calls += 1;
    return route.fulfill({
      status: 429,
      headers: { "retry-after": "33000", "access-control-allow-origin": "*" },
      json: { error: { status: 429, message: "Too many requests", reason: "QUOTA_EXCEEDED" } },
    });
  });
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Recently added" })).toBeVisible();
  await expect.poll(() => calls).toBeGreaterThan(0);
  await expect(page.getByRole("status", { name: "Spotify status" })).toContainText("Spotify requests are paused");
  const before = calls;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Recently added" })).toBeVisible();
  await openAlbum(page, "Night Transit");
  await page.locator(".meta-artist").click();
  await expect(page.getByRole("heading", { level: 1, name: "Neon Harbor" })).toBeVisible();

  const noticeBounds = await page.getByRole("status", { name: "Spotify status" }).boundingBox();
  const artistTopBarBounds = await page.locator(".artist-page > .topbar").boundingBox();

  expect(noticeBounds).not.toBeNull();
  expect(artistTopBarBounds).not.toBeNull();
  expect((noticeBounds?.y ?? 0) + (noticeBounds?.height ?? 0)).toBeLessThanOrEqual(artistTopBarBounds?.y ?? 0);

  await page.goto("/search?q=glass");
  await expect(page.getByRole("region", { name: "In your library", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "On Spotify", exact: true })).toContainText(
    "Search will resume after Spotify’s cooldown",
  );
  await expect(page.getByRole("status", { name: "Spotify status" }).locator("time")).toHaveAttribute("datetime", /T/);
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
    await route.fulfill({
      response: res,
      json: {
        ...((await res.json()) as object),
        spotify: true,
        spotifyConnected: true,
        spotifyPlayback: true,
        spotifyEnabled: false,
      },
    });
  });
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Recently added" })).toBeVisible();
  await page.goto("/search?q=glass");
  await expect(page.getByRole("region", { name: "In your library", exact: true })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("switch", { name: "Use Spotify in Needle" })).toHaveAttribute("aria-checked", "false");
  expect(calls).toBe(0);
});

test("retains cached Spotify library through a quota error and reload", async ({ page }) => {
  await mockSpotify(page);
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Your Spotify playlists" })).toBeVisible();
  const liked = page.locator("nav.side .lib-item", { hasText: "Liked on Spotify" });
  await expect(liked).toBeVisible();
  await page.goto("/search?q=glass");
  await expect(
    page.getByRole("region", { name: "On Spotify", exact: true }).getByRole("heading", { name: "Songs", exact: true }),
  ).toBeVisible();
  let calls = 0;
  await page.route("https://api.spotify.com/v1/**", (route) => {
    calls += 1;
    return route.fulfill({
      status: 429,
      headers: { "retry-after": "58577", "access-control-allow-origin": "*" },
      json: { error: { status: 429, message: "Too many requests" } },
    });
  });
  await page.getByRole("searchbox", { name: "Search", exact: true }).fill("quota");
  await expect(page.getByRole("status", { name: "Spotify status" })).toBeVisible();
  await expect(liked).toBeVisible();
  await expect(page.getByRole("region", { name: "On Spotify", exact: true })).toContainText("Search will resume");
  const before = calls;
  await liked.click();
  await expect(page.getByRole("heading", { level: 1, name: "Liked on Spotify" })).toBeVisible();
  await expect(page.locator(".tr")).toHaveCount(3);
  await page
    .locator(".tr")
    .first()
    .getByRole("button", { name: /^Remove .+ from liked songs$/ })
    .click();
  await expect(
    page.getByText("Spotify requests are paused. Try again after the cooldown.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".tr")).toHaveCount(3);
  await page.reload();
  await expect(page.getByRole("status", { name: "Spotify status" })).toBeVisible();
  await expect(page.locator(".tr")).toHaveCount(3);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your Spotify playlists" })).toBeVisible();
  expect(calls).toBe(before);
});

test("resumes search automatically after a persisted cooldown expires", async ({ page }) => {
  await mockSpotify(page);
  await page.clock.install();
  await page.addInitScript(() => {
    if (!localStorage.getItem("needle.spotifyBlockedUntil"))
      localStorage.setItem("needle.spotifyBlockedUntil", String(Date.now() + 60_000));
  });
  let searches = 0;
  page.on("request", (request) => {
    if (request.url().startsWith("https://api.spotify.com/v1/search")) searches += 1;
  });
  await signIn(page, "/search?q=glass");
  await expect(page.getByRole("status", { name: "Spotify status" })).toBeVisible();
  await expect(page.getByRole("region", { name: "On Spotify", exact: true })).toContainText("Search will resume");
  expect(searches).toBe(0);
  await page.clock.fastForward(60_001);
  await expect(page.getByRole("status", { name: "Spotify status" })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "On Spotify", exact: true }).getByRole("heading", { name: "Songs", exact: true }),
  ).toBeVisible();
  expect(searches).toBeGreaterThan(0);
});
