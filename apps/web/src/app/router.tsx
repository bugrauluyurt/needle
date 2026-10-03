import { cloneElement, lazy, Suspense } from "react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { createBrowserRouter } from "react-router";
import { Shell } from "../layout/Shell.tsx";

const Home = lazy(() => import("../pages/Home.tsx"));
const Search = lazy(() => import("../features/search/routes/SearchPage.tsx"));
const AlbumPage = lazy(() => import("../features/catalog/routes/AlbumPage.tsx"));
const ArtistPage = lazy(() => import("../features/catalog/routes/ArtistPage.tsx"));
const PlaylistPage = lazy(() => import("../features/library/routes/PlaylistPage.tsx"));
const LikedPage = lazy(() => import("../features/library/routes/LikedPage.tsx"));
const MixPage = lazy(() => import("../pages/Mix.tsx"));
const DiscoveryPage = lazy(() => import("../pages/Discovery.tsx"));
const GenrePage = lazy(() => import("../features/catalog/routes/GenrePage.tsx"));
const LyricsPage = lazy(() => import("../pages/LyricsPage.tsx"));
const Stats = lazy(() => import("../pages/Stats.tsx"));
const Radio = lazy(() => import("../pages/Radio.tsx"));
const Settings = lazy(() => import("../features/settings/routes/SettingsPage.tsx"));
const Library = lazy(() => import("../features/library/routes/LibraryPage.tsx"));
const Downloads = lazy(() => import("../features/library/routes/DownloadsPage.tsx"));
const You = lazy(() => import("../pages/You.tsx"));
const AlbumGrid = lazy(() => import("../features/catalog/routes/AlbumGridPage.tsx"));
const NotFound = lazy(() => import("../pages/NotFound.tsx"));
const Requests = lazy(() => import("../pages/Requests.tsx"));
const LikedArtists = lazy(() => import("../features/catalog/routes/LikedArtistsPage.tsx"));

function spotifyPage(name: "SpotifyLikedPage" | "SpotifyPlaylistPage" | "SpotifyAlbumPage" | "SpotifyArtistPage") {
  return lazy(() =>
    import("../features/spotify/routes/SpotifyRoutes.tsx").then((spotifyModule) => ({ default: spotifyModule[name] })),
  );
}

const SpotifyLiked = spotifyPage("SpotifyLikedPage");
const SpotifyPlaylist = spotifyPage("SpotifyPlaylistPage");
const SpotifyAlbum = spotifyPage("SpotifyAlbumPage");
const SpotifyArtist = spotifyPage("SpotifyArtistPage");

function youtubeMusicPage(
  name: "YouTubeMusicLikedPage" | "YouTubeMusicPlaylistPage" | "YouTubeMusicAlbumPage" | "YouTubeMusicArtistPage",
) {
  return lazy(() =>
    import("../features/youtube-music/routes/YouTubeMusicRoutes.tsx").then((youtubeMusicModule) => ({
      default: youtubeMusicModule[name],
    })),
  );
}

const YouTubeMusicLiked = youtubeMusicPage("YouTubeMusicLikedPage");
const YouTubeMusicPlaylist = youtubeMusicPage("YouTubeMusicPlaylistPage");
const YouTubeMusicAlbum = youtubeMusicPage("YouTubeMusicAlbumPage");
const YouTubeMusicArtist = youtubeMusicPage("YouTubeMusicArtistPage");

function LocalizedPage({ page }: { page: ReactElement }) {
  const { i18n } = useTranslation();

  return cloneElement(page as ReactElement<{ language?: string }>, {
    language: i18n.resolvedLanguage,
  });
}

function suspensePage(page: ReactElement) {
  return (
    <Suspense fallback={<div className="page-loading" aria-busy="true" />}>
      <LocalizedPage page={page} />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: suspensePage(<Home />) },
      { path: "/search", element: suspensePage(<Search />) },
      { path: "/album/:id", element: suspensePage(<AlbumPage />) },
      { path: "/artist/:id", element: suspensePage(<ArtistPage />) },
      { path: "/playlist/:id", element: suspensePage(<PlaylistPage />) },
      { path: "/liked", element: suspensePage(<LikedPage />) },
      { path: "/mix/:id", element: suspensePage(<MixPage />) },
      { path: "/listenbrainz/:id", element: suspensePage(<DiscoveryPage />) },
      { path: "/genre/:name", element: suspensePage(<GenrePage />) },
      { path: "/lyrics", element: suspensePage(<LyricsPage />) },
      { path: "/stats", element: suspensePage(<Stats />) },
      { path: "/radio", element: suspensePage(<Radio />) },
      { path: "/settings", element: suspensePage(<Settings />) },
      { path: "/library", element: suspensePage(<Library />) },
      { path: "/downloads", element: suspensePage(<Downloads />) },
      { path: "/requests", element: suspensePage(<Requests />) },
      { path: "/artists/liked", element: suspensePage(<LikedArtists />) },
      { path: "/you", element: suspensePage(<You />) },
      { path: "/albums/:type", element: suspensePage(<AlbumGrid />) },
      { path: "/spotify/liked", element: suspensePage(<SpotifyLiked />) },
      {
        path: "/spotify/playlist/:id",
        element: suspensePage(<SpotifyPlaylist />),
      },
      { path: "/spotify/album/:id", element: suspensePage(<SpotifyAlbum />) },
      { path: "/spotify/artist/:id", element: suspensePage(<SpotifyArtist />) },
      {
        path: "/youtube-music/liked",
        element: suspensePage(<YouTubeMusicLiked />),
      },
      {
        path: "/youtube-music/playlist/:id",
        element: suspensePage(<YouTubeMusicPlaylist />),
      },
      {
        path: "/youtube-music/album/:id",
        element: suspensePage(<YouTubeMusicAlbum />),
      },
      {
        path: "/youtube-music/artist/:id",
        element: suspensePage(<YouTubeMusicArtist />),
      },
      { path: "*", element: suspensePage(<NotFound />) },
    ],
  },
]);
