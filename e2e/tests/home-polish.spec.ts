import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Artist, Capabilities, Stats, SubsonicEnvelope } from "@needle/shared";
import { PASSWORD, signIn, USER } from "./helpers.ts";
import { mockSpotify } from "./spotify-mock.ts";

async function mockTopArtists(page: Page, period: "month" | "quarter" = "month") {
  const artistFixture = { libraryArtistId: "" };

  await page.route(`**/api/stats?period=${period}`, async (route) => {
    const artistParams = new URLSearchParams({ u: USER, p: PASSWORD, c: "e2e", v: "1.16.1", f: "json" });
    const artistUrl = new URL(`/rest/getArtists.view?${artistParams.toString()}`, route.request().url());
    const [statsResponse, artistsResponse] = await Promise.all([route.fetch(), route.fetch({ url: artistUrl.toString() })]);
    const stats = await statsResponse.json() as Stats;
    const artistsEnvelope = await artistsResponse.json() as SubsonicEnvelope<{ artists: { index?: { artist?: Artist[] }[] } }>;
    const libraryArtist = artistsEnvelope["subsonic-response"].artists.index?.flatMap((artistIndex) => artistIndex.artist ?? []).find((artist) => artist.name === "Neon Harbor");

    if (!libraryArtist) throw new Error("Neon Harbor is missing from the test library");

    artistFixture.libraryArtistId = libraryArtist.id;

    await route.fulfill({
      response: statsResponse,
      json: {
        ...stats,
        topArtists: [
          { id: "sp:ar1", name: "Lumen Drift", plays: 12 },
          { id: libraryArtist.id, name: libraryArtist.name, plays: 7 },
        ],
      },
    });
  });

  return artistFixture;
}

function getHomeCards(page: Page, title: string) {
  return page.locator(".row-h").filter({ has: page.getByRole("heading", { level: 2, name: title, exact: true }) }).locator("xpath=following-sibling::*[1]");
}

test("monthly artists keep their ranking, artwork and source routes", async ({ page }) => {
  const spotify = await mockSpotify(page);

  const artistFixture = await mockTopArtists(page);

  await signIn(page);

  const artistCards = getHomeCards(page, "Your top artists this month");
  const spotifyArtist = artistCards.locator(".card", { hasText: "Lumen Drift" });
  const libraryArtist = artistCards.locator(".card", { hasText: "Neon Harbor" });

  await expect(artistCards.locator(".t")).toHaveText(["Lumen Drift", "Neon Harbor"]);
  await expect(artistCards.locator(".s")).toHaveText(["12 plays", "7 plays"]);
  await expect(spotifyArtist.getByRole("img", { name: "From Spotify", exact: true })).toBeVisible();
  await expect(libraryArtist.getByRole("img", { name: "From your library", exact: true })).toBeVisible();
  await spotifyArtist.scrollIntoViewIfNeeded();
  await expect(spotifyArtist.locator(".art.loaded img")).toHaveAttribute("src", /^https:\/\/i\.scdn\.co\/image\/ar1$/);
  await expect(libraryArtist.locator(".art.loaded img")).toHaveAttribute("src", /^\/rest\/getCoverArt\.view\?/);
  await expect(spotifyArtist.locator(".card-link")).toHaveAttribute("href", "/spotify/artist/ar1");
  await expect(libraryArtist.locator(".card-link")).toHaveAttribute("href", `/artist/${artistFixture.libraryArtistId}`);

  expect(spotify.artistReleaseRequests).toHaveLength(0);

  await spotifyArtist.locator(".card-link").click();
  await expect(page).toHaveURL(/\/spotify\/artist\/ar1$/);
  await expect(page.getByRole("heading", { level: 1, name: "Lumen Drift", exact: true })).toBeVisible();
  await page.goto("/");
  await libraryArtist.locator(".card-link").click();
  await expect(page).toHaveURL(new RegExp(`/artist/${artistFixture.libraryArtistId}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Neon Harbor", exact: true })).toBeVisible();
});

test("mix covers have no source badges while library albums retain them", async ({ page }) => {
  await signIn(page);

  const mixCards = getHomeCards(page, "Mixes from your library");
  const albumCards = getHomeCards(page, "Recently added");

  await expect(mixCards.locator(".card").first()).toBeVisible();
  await expect(mixCards.getByRole("img", { name: "From your library", exact: true })).toHaveCount(0);
  await expect(mixCards.getByRole("img", { name: "From Spotify", exact: true })).toHaveCount(0);
  await expect(albumCards.locator(".card").first().getByRole("img", { name: "From your library", exact: true })).toBeVisible();
});

test("Spotify monthly history falls back without contacting Spotify when disabled", async ({ page }) => {
  await mockSpotify(page);
  await mockTopArtists(page);
  await page.route("**/api/capabilities", async (route) => {
    const capabilitiesResponse = await route.fetch();
    const capabilities = await capabilitiesResponse.json() as Capabilities;

    await route.fulfill({ response: capabilitiesResponse, json: { ...capabilities, spotify: true, spotifyConnected: true, spotifyEnabled: false } });
  });

  const spotifyRequests: string[] = [];

  page.on("request", (request) => {
    if (request.url().startsWith("https://api.spotify.com/") || request.url().startsWith("https://sdk.scdn.co/")) spotifyRequests.push(request.url());
  });

  await signIn(page);

  const artistCards = getHomeCards(page, "Your top artists this month");
  const spotifyArtist = artistCards.locator(".card", { hasText: "Lumen Drift" });

  await expect(artistCards.locator(".t")).toHaveText(["Lumen Drift", "Neon Harbor"]);
  await spotifyArtist.scrollIntoViewIfNeeded();
  await expect(spotifyArtist.locator(".art-fallback")).toBeVisible();
  await expect(spotifyArtist.getByRole("img", { name: "From Spotify", exact: true })).toBeVisible();
  await expect(artistCards.locator(".card", { hasText: "Neon Harbor" }).locator(".art.loaded img")).toBeVisible();
  expect(spotifyRequests).toEqual([]);
});


for (const path of ["/", "/radio"]) {
  test(`${path === "/" ? "Home" : "Radio"} portraits never fetch album catalogues, even when those are throttled`, async ({ page }) => {
    await mockSpotify(page);
    await mockTopArtists(page, path === "/" ? "month" : "quarter");
    let albumRequests = 0;
    await page.route("https://api.spotify.com/v1/artists/*/albums?*", (route) => {
      albumRequests += 1;
      return route.fulfill({ status: 429, headers: { "retry-after": "58577", "access-control-allow-origin": "*" }, json: { error: { status: 429, message: "Too many requests", reason: "QUOTA_EXCEEDED" } } });
    });
    await signIn(page, path);
    const artist = path === "/"
      ? getHomeCards(page, "Your top artists this month").locator(".card", { hasText: "Lumen Drift" })
      : page.locator(".radio-card", { hasText: "Lumen Drift radio" });
    await expect(artist.locator(".art.loaded img")).toBeVisible();
    await expect(page.locator("nav.side .lib-item", { hasText: "Liked on Spotify" })).toBeVisible();
    await expect(page.getByRole("status", { name: "Spotify status" })).toHaveCount(0);
    expect(albumRequests).toBe(0);
  });
}


test("Home waits for library artwork before looking it up on Spotify", async ({ page }) => {
  const spotify = await mockSpotify(page);
  await mockTopArtists(page);
  let releaseArtists = () => {};
  const artistsReady = new Promise<void>((resolve) => { releaseArtists = resolve; });
  await page.route("**/rest/getArtists.view", async (route) => {
    await artistsReady;
    await route.fulfill({ response: await route.fetch() });
  });
  try {
    await signIn(page);
    const artists = getHomeCards(page, "Your top artists this month");
    const neonHarborSearches = () =>
      spotify.searches.filter(
        (spotifySearch) => spotifySearch.query === "Neon Harbor",
      );
    await expect(artists.locator(".t")).toHaveText(["Lumen Drift", "Neon Harbor"]);
    expect(neonHarborSearches()).toHaveLength(0);
    releaseArtists();
    await expect(artists.locator(".card", { hasText: "Neon Harbor" }).locator(".art.loaded img")).toHaveAttribute("src", /^\/rest\/getCoverArt\.view\?/);
    expect(neonHarborSearches()).toHaveLength(0);
  } finally {
    releaseArtists();
  }
});
