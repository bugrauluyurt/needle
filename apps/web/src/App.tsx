import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { useDetails } from "./components/songDetailsStore.ts";
import { Shell } from "./layout/Shell.tsx";
import { loadOffline } from "./offline/store.ts";
import { startPlayer } from "./player/controller.ts";
import { queryClient } from "./queries/client.ts";
import { prefetchStart } from "./queries/hooks.ts";
import { clearSpotifyCache } from "./queries/spotify.ts";
import { startRemote, stopRemote } from "./remote/client.ts";
import { useSession } from "./state/session.ts";
import { Login } from "./pages/Login.tsx";

const SongDetailsDialog = lazy(() => import("./components/SongDetails.tsx"));
const Home = lazy(() => import("./pages/Home.tsx"));
const Search = lazy(() => import("./pages/Search.tsx"));
const AlbumPage = lazy(() => import("./pages/Album.tsx"));
const ArtistPage = lazy(() => import("./pages/Artist.tsx"));
const PlaylistPage = lazy(() => import("./pages/Playlist.tsx"));
const LikedPage = lazy(() => import("./pages/Liked.tsx"));
const MixPage = lazy(() => import("./pages/Mix.tsx"));
const GenrePage = lazy(() => import("./pages/Genre.tsx"));
const LyricsPage = lazy(() => import("./pages/LyricsPage.tsx"));
const Stats = lazy(() => import("./pages/Stats.tsx"));
const Radio = lazy(() => import("./pages/Radio.tsx"));
const Settings = lazy(() => import("./pages/Settings.tsx"));
const Library = lazy(() => import("./pages/Library.tsx"));
const Downloads = lazy(() => import("./pages/Downloads.tsx"));
const You = lazy(() => import("./pages/You.tsx"));
const AlbumGrid = lazy(() => import("./pages/AlbumGrid.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const spotifyPage = (name: "SpotifyLikedPage" | "SpotifyPlaylistPage" | "SpotifyAlbumPage" | "SpotifyArtistPage") =>
  lazy(() => import("./pages/Spotify.tsx").then((m) => ({ default: m[name] })));
const SpotifyLiked = spotifyPage("SpotifyLikedPage");
const SpotifyPlaylist = spotifyPage("SpotifyPlaylistPage");
const SpotifyAlbum = spotifyPage("SpotifyAlbumPage");
const SpotifyArtist = spotifyPage("SpotifyArtistPage");

const page = (el: React.ReactNode) => <Suspense fallback={<div className="page-loading" aria-busy="true" />}>{el}</Suspense>;

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: "/", element: page(<Home />) },
      { path: "/search", element: page(<Search />) },
      { path: "/album/:id", element: page(<AlbumPage />) },
      { path: "/artist/:id", element: page(<ArtistPage />) },
      { path: "/playlist/:id", element: page(<PlaylistPage />) },
      { path: "/liked", element: page(<LikedPage />) },
      { path: "/mix/:id", element: page(<MixPage />) },
      { path: "/genre/:name", element: page(<GenrePage />) },
      { path: "/lyrics", element: page(<LyricsPage />) },
      { path: "/stats", element: page(<Stats />) },
      { path: "/radio", element: page(<Radio />) },
      { path: "/settings", element: page(<Settings />) },
      { path: "/library", element: page(<Library />) },
      { path: "/downloads", element: page(<Downloads />) },
      { path: "/you", element: page(<You />) },
      { path: "/albums/:type", element: page(<AlbumGrid />) },
      { path: "/spotify/liked", element: page(<SpotifyLiked />) },
      { path: "/spotify/playlist/:id", element: page(<SpotifyPlaylist />) },
      { path: "/spotify/album/:id", element: page(<SpotifyAlbum />) },
      { path: "/spotify/artist/:id", element: page(<SpotifyArtist />) },
      { path: "*", element: page(<NotFound />) },
    ],
  },
]);

export function App() {
  const signedIn = useSession((s) => Boolean(s.credentials));
  const details = useDetails((s) => Boolean(s.song));
  useEffect(() => {
    if (!signedIn) {
      stopRemote();
      queryClient.clear();
      clearSpotifyCache();
      return;
    }
    prefetchStart(queryClient);
    startPlayer();
    startRemote();
    void loadOffline();
  }, [signedIn]);
  return (
    <QueryClientProvider client={queryClient}>
      {signedIn ? <RouterProvider router={router} /> : <Login />}
      {details ? <Suspense fallback={null}><SongDetailsDialog /></Suspense> : null}
    </QueryClientProvider>
  );
}
