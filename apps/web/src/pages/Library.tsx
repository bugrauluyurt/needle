import { useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import type { Song } from "@needle/shared";
import { RowHeader } from "../components/Cards.tsx";
import { CollectionBody, CollectionTools } from "../components/Collection.tsx";
import { Icon } from "../components/Icon.tsx";
import { FilterChips, LIBRARY_FILTERS, LibrarySource } from "../components/SearchResults.tsx";
import type { Filter } from "../components/SearchResults.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { AS_GIVEN, LIBRARY_SONG_SORTS, LIKED_SORTS, RECENT_FIRST, shownSongs } from "../lib/songs.ts";
import type { SongOrder } from "../lib/songs.ts";
import { useDebounced } from "../lib/useDelayed.ts";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { LIBRARY_SORTS, libraryEmptyText, useLibraryEntries, useLibraryOrigin, useLibrarySort, useNewPlaylist } from "../layout/Sidebar.tsx";
import { SearchHeader } from "../layout/SearchHeader.tsx";
import { useLibrarySongs } from "../queries/hooks.ts";
import { useSpotifyLiked, useSpotifyOn } from "../queries/spotify.ts";
import { useYouTubeMusicAlbums, useYouTubeMusicArtists, useYouTubeMusicLiked, useYouTubeMusicOn, useYouTubeMusicPlaylists } from "../queries/youtube-music.ts";
import { useYouTubeMusicStatus } from "../lib/youtube-music.ts";
import { YouTubeMusicNotice } from "../components/YouTubeMusicNotice.tsx";
import type { CollectionOrder } from "../components/Collection.tsx";
import type { CollectionView, LibraryFilter, LibraryOrigin } from "../state/ui.ts";

const KINDS: Partial<Record<Filter, LibraryFilter>> = { Albums: "albums", Artists: "artists", Playlists: "playlists" };
const CONTEXT = { kind: "search" as const, name: "Your library" };

function useSongs(origin: LibraryOrigin, query: string, order: SongOrder, youtubeMusicLimit = 100): { songs: Song[]; pending: boolean } {
  const includeLocal = origin === "server" || origin === "all";
  const server = useLibrarySongs(includeLocal);
  const spotify = useSpotifyLiked();
  const spotifyOn = useSpotifyOn();
  const youtubeMusic = useYouTubeMusicLiked(youtubeMusicLimit);
  return useMemo(() => {
    const localSongs = includeLocal ? server.data ?? [] : [];
    const spotifySongs = spotifyOn && (origin === "spotify" || origin === "all") ? spotify.data ?? [] : [];
    const youtubeSongs = origin === "youtubeMusic" || origin === "all" ? youtubeMusic.data ?? [] : [];

    return { songs: shownSongs([...localSongs, ...spotifySongs, ...youtubeSongs], order, query), pending: includeLocal && server.isPending || origin === "spotify" && spotify.isLoading || origin === "youtubeMusic" && youtubeMusic.isLoading };
  }, [origin, includeLocal, query, order, server.data, server.isPending, spotify.data, spotify.isLoading, spotifyOn, youtubeMusic.data, youtubeMusic.isLoading]);
}

function AllSongs({ origin, order, onOrder, youtubeMusicLimit }: { origin: LibraryOrigin; order: SongOrder; onOrder: (o: SongOrder) => void; youtubeMusicLimit: number }) {
  const { songs, pending } = useSongs(origin, "", order, youtubeMusicLimit);
  if (pending) return <p className="muted source-note"><span className="spin" />Loading your songs…</p>;
  if (!songs.length) return <p className="muted">{origin === "spotify" ? "No liked songs on Spotify yet." : origin === "youtubeMusic" ? "No liked songs on YouTube Music yet." : "No songs yet. Get music from Search."}</p>;
  return <TrackList songs={songs} context={CONTEXT} art album order={order} onOrder={onOrder} fallback={RECENT_FIRST} />;
}

function SpotifyMatches({ q, filter, kind, order, view }: { q: string; filter: Filter; kind: LibraryFilter; order: CollectionOrder; view: CollectionView }) {
  const entries = useLibraryEntries(kind, q, order, "spotify");
  const { songs } = useSongs("spotify", q, AS_GIVEN);
  const shownSongs = filter === "All" || filter === "Songs" ? songs : [];
  const shownEntries = filter === "Songs" ? [] : entries;
  if (!shownSongs.length && !shownEntries.length) return <p className="muted source-note">Nothing in your Spotify library matches “{q}”.</p>;
  return (
    <section className="res-source bare" aria-label="In your Spotify library">
      {shownSongs.length ? (
        <>
          <RowHeader title="Liked songs on Spotify" />
          <TrackList songs={shownSongs} context={{ kind: "search", name: `Spotify library, “${q}”` }} art album />
        </>
      ) : null}
      {shownEntries.length ? (
        <>
          <RowHeader title="Saved on Spotify" />
          <CollectionBody items={shownEntries} view={view} empty="" />
        </>
      ) : null}
    </section>
  );
}

function YouTubeMusicMatches({ q, filter, kind, order, view, limit }: { q: string; filter: Filter; kind: LibraryFilter; order: CollectionOrder; view: CollectionView; limit: number }) {
  const entries = useLibraryEntries(kind, q, order, "youtubeMusic", limit);
  const { songs } = useSongs("youtubeMusic", q, AS_GIVEN, limit);
  const matchingSongs = filter === "All" || filter === "Songs" ? songs : [];
  const matchingEntries = filter === "Songs" ? [] : entries;

  if (!matchingSongs.length && !matchingEntries.length) return <p className="muted source-note">Nothing in your YouTube Music library matches “{q}”.</p>;

  return <section className="res-source bare" aria-label="In your YouTube Music library">{matchingSongs.length ? <><RowHeader title="Liked songs on YouTube Music" /><TrackList songs={matchingSongs} context={{ kind: "search", name: `YouTube Music library, “${q}”` }} art album /></> : null}{matchingEntries.length ? <><RowHeader title="Saved on YouTube Music" /><CollectionBody items={matchingEntries} view={view} empty="" /></> : null}</section>;
}

export default function LibraryPage() {
  const mobile = useIsMobile();
  const [filter, setFilter] = useState<Filter>("All");
  const [songOrder, setSongOrder] = useState<SongOrder>(RECENT_FIRST);
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [params] = useSearchParams();
  const location = useLocation();
  const find = params.has("find");
  const { origin, show } = useLibraryOrigin();
  const youtubeMusicOn = useYouTubeMusicOn();
  const spotifyOn = useSpotifyOn();
  const [youtubeMusicLimit, setYouTubeMusicLimit] = useState(100);
  const youtubeLiked = useYouTubeMusicLiked(youtubeMusicLimit);
  const youtubeAlbums = useYouTubeMusicAlbums(youtubeMusicLimit);
  const youtubeArtists = useYouTubeMusicArtists(youtubeMusicLimit);
  const youtubePlaylists = useYouTubeMusicPlaylists(youtubeMusicLimit);
  const blocked = useYouTubeMusicStatus((status) => status.blocked);
  const youtubeLibraryPages = filter === "Songs" ? [youtubeLiked] : filter === "Albums" ? [youtubeAlbums] : filter === "Artists" ? [youtubeArtists] : filter === "Playlists" ? [youtubePlaylists] : [youtubeLiked, youtubeAlbums, youtubeArtists, youtubePlaylists];
  const hasMoreYouTubeMusic = youtubeMusicOn && (origin === "all" || origin === "youtubeMusic") && youtubeMusicLimit < 3000 && youtubeLibraryPages.some((libraryPage) => libraryPage.hasMore);
  const youtubeMusicError = youtubeLibraryPages.some((libraryPage) => libraryPage.isError);
  const youtubeMusicUnavailable = origin === "youtubeMusic" && youtubeMusicError && youtubeLibraryPages.every((libraryPage) => !libraryPage.data);
  const visibleSongOrder = origin !== "server" && !LIKED_SORTS.some(([songSort]) => songSort === songOrder.key) ? RECENT_FIRST : songOrder;
  const kind = KINDS[filter] ?? null;
  const { order, setOrder, view, setView } = useLibrarySort(mobile ? "list" : "grid");
  const entries = useLibraryEntries(kind, "", order, origin, youtubeMusicLimit);
  const newPlaylist = useNewPlaylist();
  usePageTone(null);
  const create = <button type="button" className="icon-btn light" aria-label="Create playlist" onClick={newPlaylist}><Icon name="plus" size={24} /></button>;
  const tools = q ? (
    <CollectionTools sorts={[]} show={show} />
  ) : filter === "Songs" ? (
    <CollectionTools sorts={origin === "server" ? LIBRARY_SONG_SORTS : LIKED_SORTS} order={visibleSongOrder} onOrder={setSongOrder} show={show} />
  ) : (
    <CollectionTools sorts={LIBRARY_SORTS} order={order} onOrder={setOrder} view={view} onView={setView} show={show} />
  );
  const body = youtubeMusicUnavailable ? null : q ? (
    <>
      {origin === "server" || origin === "all" ? <LibrarySource q={q} filter={filter} setFilter={setFilter} heading={false} /> : null}
      {spotifyOn && (origin === "all" || origin === "spotify") ? <SpotifyMatches q={q} filter={filter} kind={kind} order={order} view={view} /> : null}
      {youtubeMusicOn && (origin === "all" || origin === "youtubeMusic") ? <YouTubeMusicMatches q={q} filter={filter} kind={kind} order={order} view={view} limit={youtubeMusicLimit} /> : null}
    </>
  ) : filter === "Songs" ? (
    <AllSongs origin={origin} order={visibleSongOrder} onOrder={setSongOrder} youtubeMusicLimit={youtubeMusicLimit} />
  ) : (
    <CollectionBody items={entries} view={view} empty={libraryEmptyText(kind, "")} />
  );
  return (
    <>
      <SearchHeader key={find ? location.key : "library"} autoFocus={find} title="Your library" label="Search in your library" placeholder="Search in your library" value={query} onChange={setQuery} actions={create} />
      <div className="pad library-page">
        {!mobile ? (
          <div className="library-head">
            <h1 className="hello">Your library</h1>
            {create}
          </div>
        ) : null}
        <FilterChips filters={LIBRARY_FILTERS} value={filter} onChange={setFilter} label="Filter your library" />
        <div className="lib-tools">{tools}</div>
        {youtubeMusicOn && origin !== "server" && origin !== "spotify" ? <YouTubeMusicNotice error={youtubeMusicError} retry={() => { for (const libraryPage of youtubeLibraryPages) void libraryPage.refetch(); }} /> : null}
        {body}
        {hasMoreYouTubeMusic ? <div className="search-pagination"><button type="button" className="btn ghost sm" disabled={blocked || youtubeLibraryPages.some((libraryPage) => libraryPage.isFetching)} onClick={() => setYouTubeMusicLimit(Math.min(youtubeMusicLimit + 100, 3000))}>Load more from YouTube Music</button></div> : null}
      </div>
    </>
  );
}
