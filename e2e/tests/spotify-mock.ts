import type { Page } from "@playwright/test";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPtfDwAE/wH+2b0bZQAAAABJRU5ErkJggg==", "base64");
const img = (name: string) => [{ url: `https://i.scdn.co/image/${name}`, width: 300, height: 300 }];
const artist = { id: "ar1", name: "Lumen Drift", images: img("ar1"), followers: { total: 12_400 } };
const albumRef = { id: "al1", name: "Glass Hours", release_date: "2021-05-07", album_type: "album", images: img("al1"), artists: [{ id: "ar1", name: "Lumen Drift" }], uri: "spotify:album:al1" };
const track = (n: number) => ({ id: `t${n}`, uri: `spotify:track:t${n}`, name: `Glass Song ${n}`, duration_ms: 200_000 + n * 1000, artists: [{ id: "ar1", name: "Lumen Drift" }], album: albumRef, track_number: n, disc_number: 1 });
const tracks = [1, 2, 3].map(track);
const album = { ...albumRef, label: "Night Label", tracks: { items: tracks.map(({ album: _, ...t }) => t), next: null, total: 3 } };
const owned = { id: "p1", name: "Road trip", owner: { id: "me", display_name: "Me" }, images: img("p1"), collaborative: false, items: { total: 2 } };
const followed = { id: "p2", name: "Chill Hits", owner: { id: "spotify", display_name: "Spotify" }, images: img("p2"), collaborative: false, items: { total: 80 } };
const page1 = <T,>(items: T[]) => ({ items, next: null, total: items.length });

export type Mock = {
  plays: { device: string | null; uris: string[] }[];
  saved: string[];
  searches: { query: string; type: string; offset: number; limit: number }[];
  artistReleaseRequests: { group: string; offset: number }[];
};

type SpotifyMockOptions = {
  searchSongCount?: number;
  artistAlbumCount?: number;
  artistImages?: { url: string; width?: number | null; height?: number | null }[];
  delayedSearch?: { query: string; offset: number; milliseconds: number };
};

export async function mockSpotify(page: Page, options: SpotifyMockOptions = {}): Promise<Mock> {
  const mock: Mock = { plays: [], saved: [], searches: [], artistReleaseRequests: [] };
  const mockArtist = options.artistImages ? { ...artist, images: options.artistImages } : artist;
  const searchTracks = Array.from({ length: options.searchSongCount ?? 3 }, (_, trackIndex) => track(trackIndex + 1));
  const artistAlbums = Array.from({ length: options.artistAlbumCount ?? 1 }, (_, albumIndex) => ({
    ...albumRef,
    id: `al${albumIndex + 1}`,
    name: albumIndex ? `Glass Hours ${albumIndex + 1}` : albumRef.name,
    release_date: `${2021 - albumIndex}-05-07`,
    uri: `spotify:album:al${albumIndex + 1}`,
  }));
  await page.route("**/api/capabilities", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()) as object, spotify: true, spotifyConnected: true, spotifyPlayback: true, spotifyReconnect: false, spotifyEnabled: true } });
  });
  await page.route("**/api/spotify/token", (route) => route.fulfill({ json: { accessToken: "fake", expiresAt: Date.now() + 3_600_000 } }));
  await page.route("https://i.scdn.co/**", (route) => route.fulfill({ body: PNG, contentType: "image/png", headers: { "access-control-allow-origin": "*" } }));
  await page.route("https://sdk.scdn.co/spotify-player.js", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `
      window.Spotify = { Player: class {
        constructor(o) { this.o = o; this.l = {}; window.__sdk = this; }
        addListener(e, cb) { this.l[e] = cb; return true; }
        connect() { setTimeout(() => this.l.ready?.({ device_id: "dev1" }), 20); return Promise.resolve(true); }
        emit(state) { this.l.player_state_changed?.(state); }
        getCurrentState() { return Promise.resolve(null); }
        setVolume() { return Promise.resolve(); }
        pause() { return Promise.resolve(); }
        resume() { return Promise.resolve(); }
        seek() { return Promise.resolve(); }
        activateElement() { return Promise.resolve(); }
      } };
      window.onSpotifyWebPlaybackSDKReady?.();
    `,
  }));
  await page.route("https://api.spotify.com/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace("/v1", "");
    const json = (body: unknown) => route.fulfill({ json: body, headers: { "access-control-allow-origin": "*" } });
    if (req.method() === "PUT" && path === "/me/player/play") {
      mock.plays.push({ device: url.searchParams.get("device_id"), uris: (req.postDataJSON() as { uris: string[] }).uris });
      return route.fulfill({ status: 204 });
    }
    if (path === "/artists/ar1/albums" && Number(url.searchParams.get("limit")) > 10) {
      return route.fulfill({ status: 400, json: { error: { status: 400, message: "Invalid limit" } } });
    }

    if (path === "/artists/ar1/albums") {
      const albumGroup = url.searchParams.get("include_groups") ?? "album,single";
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 10);
      const matchingAlbums = albumGroup.includes("album") ? artistAlbums : [];
      const nextOffset = offset + limit;
      mock.artistReleaseRequests.push({ group: albumGroup, offset });

      url.searchParams.set("offset", String(nextOffset));

      return json({ items: matchingAlbums.slice(offset, nextOffset), next: nextOffset < matchingAlbums.length ? url.toString() : null, total: matchingAlbums.length, offset, limit });
    }

    if (path === "/me/library") {
      mock.saved.push(`${req.method()} ${url.searchParams.get("uris") ?? ""}`);
      return route.fulfill({ status: 200, body: "" });
    }

    if (path === "/search") {
      const query = url.searchParams.get("q") ?? "";
      const searchType = url.searchParams.get("type") ?? "";
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 10);
      mock.searches.push({ query, type: searchType, offset, limit });

      if (options.delayedSearch?.query === query && options.delayedSearch.offset === offset) {
        await new Promise((resolve) => setTimeout(resolve, options.delayedSearch?.milliseconds));
      }

      const searchPage = <T,>(searchItems: T[], category: string) => {
        const matchingItems = query.includes("zzzz") ? [] : searchItems;
        const nextOffset = offset + limit;
        const next = nextOffset < matchingItems.length
          ? `https://api.spotify.com/v1/search?${new URLSearchParams({ q: query, type: category, offset: String(nextOffset), limit: String(limit) })}`
          : null;

        return { items: matchingItems.slice(offset, nextOffset), next, total: matchingItems.length, offset, limit };
      };

      return json({
        tracks: searchPage(searchTracks, "track"),
        albums: searchPage([albumRef], "album"),
        artists: searchPage([mockArtist], "artist"),
        playlists: searchPage([followed], "playlist"),
      });
    }

    const routes: Record<string, unknown> = {
      "/me": { id: "me", display_name: "Me", product: "premium" },
      "/me/playlists": page1([owned, followed]),
      "/playlists/p1": owned,
      "/playlists/p1/items": page1(tracks.slice(0, 2).map((t) => ({ added_at: "2026-09-01T10:00:00Z", item: t }))),
      "/playlists/p2": followed,
      "/me/tracks": page1(tracks.map((t) => ({ added_at: "2026-09-20T10:00:00Z", track: t }))),
      "/me/albums": page1([{ added_at: "2026-09-10T10:00:00Z", album }]),
      "/albums/al1": album,
      "/artists/ar1": mockArtist,
      "/me/following": { artists: page1([mockArtist]) },
    };
    if (path in routes) return json(routes[path]);
    return route.fulfill({ status: 403, json: { error: { status: 403, message: "Forbidden" } } });
  });
  return mock;
}
