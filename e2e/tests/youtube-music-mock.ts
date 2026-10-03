import type { Page } from "@playwright/test";
import type { Song, YouTubeMusicAlbum, YouTubeMusicArtist, YouTubeMusicPlaylist } from "@needle/shared";

const IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPtfDwAE/wH+2b0bZQAAAABJRU5ErkJggg==",
  "base64",
);
const artist: YouTubeMusicArtist = {
  id: "ytm:UC_artist",
  name: "Lumen Drift",
  images: [],
  subscribers: "12.4K",
  subscribed: true,
};
const album: YouTubeMusicAlbum = {
  id: "ytm:MPRE_album",
  title: "Glass Hours on YouTube",
  artists: [{ id: artist.id, name: artist.name }],
  images: [{ url: "https://lh3.googleusercontent.com/needle-test", width: 300, height: 300 }],
  year: 2021,
};
const playlist: YouTubeMusicPlaylist = {
  id: "ytm:PL_playlist",
  title: "Night bus home",
  images: album.images,
  author: "Needle listener",
  songCount: 3,
};
const song = (songIndex: number): Song => ({
  id: `ytm:video0000${String(songIndex).padStart(2, "0")}`,
  title: `YouTube Song ${songIndex}`,
  artist: artist.name,
  artistId: artist.id,
  artists: album.artists,
  albumId: album.id,
  album: album.title,
  ...(album.images[0] ? { coverArt: album.images[0].url } : {}),
  duration: 201,
  source: "youtubeMusic",
  track: songIndex,
});
const pageItems = <T>(items: T[], limit = 100) => ({
  items: items.slice(0, limit),
  total: items.length,
  hasMore: items.length > limit,
  limit,
});

export type YouTubeMusicMock = {
  requests: { path: string; method: string; limit: number; query: string; kind: string }[];
  writes: string[];
  enabled: boolean;
  connected: boolean;
  reconnect: boolean;
  accountName: string;
};

export async function mockYouTubeMusic(
  page: Page,
  options: {
    enabled?: boolean;
    connected?: boolean;
    songCount?: number;
    searchFailure?: number;
    missingArt?: boolean;
    denyWrites?: boolean;
    libraryCount?: number;
    libraryFailure?: number;
    reconnect?: boolean;
    nextAccountName?: string;
    verificationUrl?: string;
  } = {},
): Promise<YouTubeMusicMock> {
  const mock: YouTubeMusicMock = {
    requests: [],
    writes: [],
    enabled: options.enabled ?? true,
    connected: options.connected ?? true,
    reconnect: options.reconnect ?? false,
    accountName: "Needle listener",
  };
  const songs = Array.from({ length: options.songCount ?? 3 }, (_, songIndex) => song(songIndex + 1));
  let savedAlbums = [
    ...Array.from({ length: (options.libraryCount ?? 1) - 1 }, (_, albumIndex): YouTubeMusicAlbum => ({
      ...album,
      id: `ytm:MPRE_other${albumIndex}`,
      title: `Other album ${albumIndex + 1}`,
    })),
    album,
  ];
  let followedArtists = [
    ...Array.from({ length: (options.libraryCount ?? 1) - 1 }, (_, artistIndex): YouTubeMusicArtist => ({
      ...artist,
      id: `ytm:UC_other${artistIndex}`,
      name: `Other artist ${artistIndex + 1}`,
    })),
    artist,
  ];
  let likedSongs = songs;
  let loginStarted = false;

  await page.route("https://lh3.googleusercontent.com/**", (route) =>
    route.fulfill({ body: IMAGE, contentType: "image/png", headers: { "access-control-allow-origin": "*" } }),
  );
  await page.route("**/api/capabilities", async (route) => {
    const response = await route.fetch();

    await route.fulfill({
      response,
      json: {
        ...((await response.json()) as object),
        youtubeMusic: true,
        youtubeMusicConnected: mock.connected,
        youtubeMusicEnabled: mock.enabled,
        youtubeMusicReconnect: mock.reconnect,
      },
    });
  });
  await page.route("**/api/youtube-music**", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const path = requestUrl.pathname.replace("/api/youtube-music", "");
    const limit = Number(requestUrl.searchParams.get("limit") ?? 20);
    const query = requestUrl.searchParams.get("q") ?? "";
    const kind = requestUrl.searchParams.get("kind") ?? "";

    mock.requests.push({ path, method: request.method(), limit, query, kind });

    if (path === "/login") {
      if (request.method() === "POST") {
        loginStarted = true;

        return route.fulfill({
          json: {
            userCode: "TEST-CODE",
            verificationUrl: options.verificationUrl ?? "https://www.google.com/device",
            expiresAt: Date.now() + 300_000,
            interval: 1,
          },
        });
      }

      if (request.method() === "DELETE") return route.fulfill({ status: 204 });

      if (loginStarted) {
        mock.connected = true;
        mock.reconnect = false;

        if (options.nextAccountName) {
          mock.accountName = options.nextAccountName;
          likedSongs = songs.map((accountSong) => ({
            ...accountSong,
            title: `${options.nextAccountName} ${accountSong.title}`,
          }));
        }
      }

      return route.fulfill({ json: { state: loginStarted ? "connected" : "pending" } });
    }

    if (path === "/enabled") {
      mock.enabled = (request.postDataJSON() as { on: boolean }).on;

      return route.fulfill({ status: 204 });
    }

    if (path === "" && request.method() === "DELETE") {
      mock.connected = false;

      return route.fulfill({ status: 204 });
    }

    if (request.method() === "PUT") {
      const on = (request.postDataJSON() as { on: boolean }).on;

      mock.writes.push(`${path}:${on}`);

      if (options.denyWrites)
        return route.fulfill({ status: 502, json: { error: "YouTube Music didn’t take that change" } });

      if (path.includes("/follow"))
        followedArtists = on
          ? [...followedArtists.filter((savedArtist) => savedArtist.id !== artist.id), artist]
          : followedArtists.filter((savedArtist) => savedArtist.id !== artist.id);
      if (path.includes("/saved"))
        savedAlbums = on
          ? [...savedAlbums.filter((savedAlbum) => savedAlbum.id !== album.id), album]
          : savedAlbums.filter((savedAlbum) => savedAlbum.id !== album.id);
      if (path.includes("/like")) likedSongs = on ? songs : [];

      return route.fulfill({ status: 204 });
    }

    if (options.libraryFailure && ["/liked", "/albums", "/artists", "/playlists"].includes(path))
      return route.fulfill({ status: options.libraryFailure, json: { error: "YouTube Music didn’t answer" } });

    if (path === "/account") return route.fulfill({ json: { name: mock.accountName, handle: "@needle", photo: null } });
    if (path === "/liked") return route.fulfill({ json: pageItems(likedSongs, limit) });
    if (path === "/albums") return route.fulfill({ json: pageItems(savedAlbums, limit) });
    if (path === "/artists") return route.fulfill({ json: pageItems(followedArtists, limit) });
    if (path === "/playlists") return route.fulfill({ json: pageItems([playlist], limit) });
    if (path === "/albums/MPRE_album")
      return route.fulfill({ json: { album: options.missingArt ? { ...album, images: [] } : album, songs } });
    if (path === "/artists/UC_artist")
      return route.fulfill({
        json: {
          artist: { ...artist, subscribed: followedArtists.some((savedArtist) => savedArtist.id === artist.id) },
          songs: songs.slice(0, 20),
          albums: [album],
          singles: [album],
          hasMoreSongs: songs.length > 20,
          hasMoreAlbums: false,
          hasMoreSingles: false,
        },
      });
    if (path === "/artists/UC_artist/songs") return route.fulfill({ json: pageItems(songs, limit) });
    if (path === "/artists/UC_artist/releases") return route.fulfill({ json: pageItems([album], limit) });
    if (path === "/playlists/PL_playlist") return route.fulfill({ json: { playlist, songs: pageItems(songs, limit) } });
    if (path === "/search")
      return options.searchFailure
        ? route.fulfill({ status: options.searchFailure, json: { error: "YouTube Music requests are paused" } })
        : route.fulfill({
            json: {
              songs: query === "zzzz" ? [] : songs.slice(0, limit),
              albums: query === "zzzz" ? [] : [album],
              artists: query === "zzzz" ? [] : [artist],
              playlists: query === "zzzz" ? [] : [playlist],
              hasMore: query !== "zzzz" && songs.length > limit,
              limit,
            },
          });
    if (path === "/import")
      return route.fulfill({
        json: {
          source: playlist.title,
          matched: 2,
          total: 3,
          missing: [{ title: "Missing song", artist: artist.name, album: album.title }],
          playlistId: "imported",
        },
      });
    if (/^\/songs\/[^/]+\/lyrics$/.test(path))
      return route.fulfill({
        json: { lyrics: [{ synced: false, line: [{ value: "A line from YouTube Music" }] }], source: "YouTube Music" },
      });
    if (/^\/songs\/[^/]+\/radio$/.test(path)) return route.fulfill({ json: songs });

    return route.fulfill({ status: 404, json: { error: `Unhandled mock route ${path}` } });
  });

  return mock;
}
