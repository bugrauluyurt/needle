import { useMemo, useState } from "react";
import { Collection, CollectionTools, RELEASE_SORTS } from "../components/Collection.tsx";
import { SearchField } from "../components/SearchField.tsx";
import { AS_GIVEN, LIKED_SORTS, RECENT_FIRST, shownSongs, SONG_SORTS } from "../lib/songs.ts";
import type { SongOrder } from "../lib/songs.ts";
import { Link, useParams, useSearchParams } from "react-router";
import type { Song } from "@needle/shared";
import { Art, LikedArt } from "../components/Art.tsx";
import { CardSkeletons, RowHeader } from "../components/Cards.tsx";
import { ActBar, Hero, PageSkeleton, PlayContextButton, ShuffleButton } from "../components/Hero.tsx";
import { Icon } from "../components/Icon.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { api } from "../lib/api.ts";
import { ago, count, longDuration, plain, plural, releaseDateLabel, releaseKind } from "../lib/format.ts";
import { artistPath } from "../lib/paths.ts";
import { image, sp, spId, spotifyLink, uniqueSpotifyItems, useSpotifyStatus } from "../lib/spotify.ts";
import { releaseYear, spotifyAlbumItem } from "../components/SpotifyCards.tsx";
import { SpotifyMark } from "../components/SpotifyMark.tsx";
import { useTone } from "../lib/tone.ts";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { MobileBack } from "../layout/Mobile.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { player } from "../player/controller.ts";
import type { PlayContext } from "../player/store.ts";
import { useCapabilities } from "../queries/hooks.ts";
import {
  spKeys,
  useSpotifyAlbum,
  useSpotifyAlbums,
  useSpotifyArtist,
  useSpotifyArtistAlbums,
  useSpotifyArtistSongs,
  useSpotifyFollowed,
  useSpotifyLiked,
  useSpotifyOn,
  useSpotifyPlaylist,
  useSpotifyPlaylistEdits,
  useSpotifyPlaylists,
  useToggleSpotifyFollow,
} from "../queries/spotify.ts";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "../state/ui.ts";

const duration = (songs: Song[]) => songs.reduce((n, s) => n + (s.duration ?? 0), 0);

function OpenInSpotify({ kind, id }: { kind: "album" | "artist" | "playlist"; id: string }) {
  return (
    <a
      className="icon-btn big"
      href={spotifyLink(kind, id)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open in Spotify"
    >
      <Icon name="link" size={22} />
    </a>
  );
}

function NotConnected() {
  return (
    <>
      <TopBar />
      <div className="empty">
        <div className="empty-in">
          <h1>Connect Spotify first</h1>
          <p>Open Settings and connect your Spotify account to see your Spotify library here.</p>
          <div className="acts">
            <Link to="/settings" className="btn primary">
              Go to Settings
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

function SpotifyError({ what, retry }: { what: string; retry: () => void }) {
  const blocked = useSpotifyStatus((s) => s.blocked);
  const mobile = useIsMobile();
  return (
    <>
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="empty">
        <div className="empty-in">
          <h1>{blocked ? "Spotify requests are paused" : `Couldn’t load this ${what} from Spotify`}</h1>
          <p>
            {blocked
              ? "This item has not been loaded yet. It will be requested when the cooldown ends."
              : `Spotify didn’t answer, or this ${what} isn’t available to apps. Try again, or reconnect Spotify in Settings.`}
          </p>
          {!blocked ? (
            <div className="acts">
              <button type="button" className="btn primary" onClick={retry}>
                <Icon name="refresh" size={16} />
                Try again
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function SpotifyLikedPage() {
  const on = useSpotifyOn();
  const { data: songs, isLoading, refetch } = useSpotifyLiked();
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<SongOrder>(RECENT_FIRST);
  usePageTone("#1F5A3A");
  const shown = useMemo(() => shownSongs(songs ?? [], order, filter), [songs, order, filter]);
  if (!on) return <NotConnected />;
  if (isLoading) return <PageSkeleton />;
  if (!songs) return <SpotifyError what="list" retry={() => void refetch()} />;
  const context: PlayContext = { kind: "liked", id: "sp:liked", name: "Liked on Spotify" };
  return (
    <div className="tinted">
      <Hero
        art={<LikedArt className="sp-liked" />}
        kind="Spotify"
        title="Liked on Spotify"
        meta={<span>{plural(songs.length, "song")}</span>}
      />
      <ActBar
        end={
          <>
            <SearchField variant="inline" value={filter} onChange={setFilter} label="Find in liked songs" />
            <CollectionTools sorts={LIKED_SORTS} order={order} onOrder={setOrder} />
          </>
        }
      >
        <PlayContextButton
          contextId="sp:liked"
          label="Liked on Spotify"
          onPlay={() => player.playSongs(shown, 0, context)}
        />
        <ShuffleButton
          label="Liked on Spotify"
          onShuffle={() => player.playSongs(shown, 0, context, { shuffle: true })}
        />
      </ActBar>
      <TrackList
        songs={shown}
        context={context}
        art
        album
        column={{ label: "Date added", value: (s) => ago(s.starred), sort: "added" }}
        order={order}
        onOrder={setOrder}
        fallback={RECENT_FIRST}
      />
    </div>
  );
}

export function SpotifyPlaylistPage() {
  const { id = "" } = useParams();
  const on = useSpotifyOn();
  const { data, isLoading, refetch } = useSpotifyPlaylist(id);
  const edits = useSpotifyPlaylistEdits();
  const { data: playlists } = useSpotifyPlaylists();
  const mine = playlists?.find((p) => p.id === id)?.mine;
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<SongOrder>(AS_GIVEN);
  const shown = useMemo(() => (data?.songs ? shownSongs(data.songs, order, filter) : null), [data, order, filter]);
  const tone = useTone(image(data?.meta.images, 64));
  usePageTone(tone);
  if (!on) return <NotConnected />;
  if (isLoading) return <PageSkeleton />;
  if (!data) return <SpotifyError what="playlist" retry={() => void refetch()} />;
  const { meta, songs } = data;
  const context: PlayContext = { kind: "playlist", id: spId(id), name: meta.name };
  const total = meta.items?.total ?? meta.tracks?.total ?? songs?.length ?? 0;
  const editable = Boolean(mine) && songs !== null && order.key === "custom" && !filter;
  return (
    <div className="tinted">
      <Hero
        art={<Art images={meta.images} px={232} eager />}
        kind={mine ? "Spotify playlist" : "Spotify playlist you follow"}
        title={meta.name}
        description={plain(meta.description)}
        meta={
          <>
            <b>{meta.owner.display_name ?? meta.owner.id}</b>
            <span>
              {plural(total, "song")}
              {songs?.length ? `, ${longDuration(duration(songs))}` : ""}
            </span>
          </>
        }
      />
      {songs ? (
        <ActBar
          end={
            songs.length ? (
              <>
                <SearchField
                  variant="inline"
                  collapsible
                  value={filter}
                  onChange={setFilter}
                  label="Find in playlist"
                />
                <CollectionTools sorts={SONG_SORTS} order={order} onOrder={setOrder} />
              </>
            ) : null
          }
        >
          {songs.length ? (
            <>
              <PlayContextButton
                contextId={context.id ?? ""}
                label={meta.name}
                onPlay={() => player.playSongs(songs, 0, context)}
              />
              <ShuffleButton
                label={meta.name}
                onShuffle={() => player.playSongs(songs, 0, context, { shuffle: true })}
              />
            </>
          ) : null}
          <OpenInSpotify kind="playlist" id={id} />
        </ActBar>
      ) : null}
      {songs === null ? (
        <div className="pad sp-note">
          <h2>Spotify keeps this playlist’s songs to itself</h2>
          <p className="muted">
            Spotify only lets personal apps read playlists you made or collaborate on. Open it in Spotify, like the
            songs you want, and they’ll show up in Liked on Spotify here.
          </p>
          <a className="btn light" href={spotifyLink("playlist", id)} target="_blank" rel="noopener noreferrer">
            <Icon name="link" size={16} />
            Open in Spotify
          </a>
        </div>
      ) : songs.length && shown ? (
        <TrackList
          songs={shown}
          context={context}
          art
          album
          column={{ label: "Added", value: (s) => ago(s.created), sort: "added" }}
          order={order}
          onOrder={setOrder}
          {...(editable
            ? {
                onReorder: (from: number, to: number) => void edits.reorder(id, from, to),
                menuExtra: (s: Song) => [
                  { label: "Remove from this playlist", icon: "trash" as const, run: () => void edits.remove(id, s) },
                ],
              }
            : {})}
        />
      ) : (
        <div className="pad empty-inline">
          <h2>This playlist is empty</h2>
          <p className="muted">Right-click any Spotify song and choose Add to playlist.</p>
        </div>
      )}
    </div>
  );
}

export function SpotifyAlbumPage() {
  const { id = "" } = useParams();
  const on = useSpotifyOn();
  const { data, isLoading, refetch } = useSpotifyAlbum(id);
  const { data: saved } = useSpotifyAlbums();
  const caps = useCapabilities();
  const qc = useQueryClient();
  const tone = useTone(image(data?.album.images, 64));
  usePageTone(tone);
  const [busy, setBusy] = useState(false);
  const [songFilter, setSongFilter] = useState("");
  const [songOrder, setSongOrder] = useState<SongOrder>(AS_GIVEN);
  const visibleSongs = useMemo(
    () => shownSongs(data?.songs ?? [], songOrder, songFilter),
    [data?.songs, songOrder, songFilter],
  );
  if (!on) return <NotConnected />;
  if (isLoading) return <PageSkeleton />;
  if (!data) return <SpotifyError what="album" retry={() => void refetch()} />;
  const { album, songs } = data;
  const context: PlayContext = { kind: "album", id: spId(album.id), name: album.name, ordered: true };
  const isSaved = Boolean(saved?.some((a) => a.id === album.id));
  const year = album.release_date?.slice(0, 4);
  const toggleSave = async () => {
    const uri = album.uri ?? `spotify:album:${album.id}`;
    try {
      await (isSaved ? sp.unsave([uri]) : sp.save([uri]));
      await qc.invalidateQueries({ queryKey: spKeys.albums });
      toast(isSaved ? "Removed from your Spotify library" : "Saved to your Spotify library");
    } catch {
      toast("Spotify didn’t take that change");
    }
  };
  const getAlbum = async () => {
    setBusy(true);
    try {
      const {
        albums: [hit],
      } = await api.lidarrSearch(`${album.artists?.[0]?.name ?? ""} ${album.name}`);
      if (!hit) toast("Lidarr couldn’t find this album");
      else {
        await api.lidarrGet(hit.foreignAlbumId);
        toast(`Lidarr is looking for ${hit.title}`);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Lidarr didn’t take the request");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tinted">
      <Hero
        art={<Art images={album.images} px={232} eager />}
        kind={`${album.album_type === "album" ? "Album" : album.album_type === "compilation" ? "Compilation" : releaseKind(songs.length, duration(songs))} on Spotify`}
        title={album.name}
        meta={
          <>
            {(album.artists ?? []).map((a) => (
              <Link key={a.id} to={artistPath(spId(a.id))} className="meta-artist">
                {a.name}
              </Link>
            ))}
            {year ? <span>{year}</span> : null}
            <span>
              {plural(songs.length, "song")}, {longDuration(duration(songs))}
            </span>
          </>
        }
      />
      <ActBar
        end={
          <SearchField variant="inline" collapsible value={songFilter} onChange={setSongFilter} label="Find in album" />
        }
      >
        <PlayContextButton
          contextId={context.id ?? ""}
          label={album.name}
          onPlay={() => player.playSongs(songs, 0, context)}
        />
        <ShuffleButton label={album.name} onShuffle={() => player.playSongs(songs, 0, context, { shuffle: true })} />
        <button
          type="button"
          className="icon-btn big"
          aria-pressed={isSaved}
          aria-label={isSaved ? "Remove from your Spotify library" : "Save to your Spotify library"}
          onClick={() => void toggleSave()}
        >
          <Icon name={isSaved ? "heartFill" : "heart"} size={28} />
        </button>
        {caps.data?.lidarr ? (
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void getAlbum()}>
            <Icon name="download" size={15} />
            {busy ? "Asking Lidarr…" : "Get album"}
          </button>
        ) : null}
        <OpenInSpotify kind="album" id={album.id} />
      </ActBar>
      <TrackList
        songs={visibleSongs}
        context={context}
        numbers="track"
        order={songOrder}
        onOrder={setSongOrder}
        onPlay={(songIndex) => {
          const selectedSong = visibleSongs[songIndex];

          if (selectedSong) player.playSongs(songs, songs.indexOf(selectedSong), context);
        }}
      />
      <div className="pad">
        {album.label || album.copyrights?.[0] ? (
          <p className="album-foot muted">
            {[year, album.label, album.copyrights?.[0]?.text].filter(Boolean).join(". ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function SpotifyArtistPage() {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const artistSection = searchParams.get("section");
  const section =
    artistSection === "songs" || artistSection === "albums" || artistSection === "singles" ? artistSection : null;
  const [songFilter, setSongFilter] = useState("");
  const on = useSpotifyOn();
  const blocked = useSpotifyStatus((s) => s.blocked);
  const mobile = useIsMobile();
  const { data, isLoading, refetch } = useSpotifyArtist(id);
  const artistSongs = useSpotifyArtistSongs(data?.artist.id ?? "", data?.artist.name ?? "");
  const artistAlbums = useSpotifyArtistAlbums(data?.artist.id ?? "", undefined, "album");
  const artistSingles = useSpotifyArtistAlbums(data?.artist.id ?? "", undefined, "single");
  const songs = useMemo(
    () => uniqueSpotifyItems(artistSongs.data?.pages.flatMap((songPage) => songPage.items) ?? []),
    [artistSongs.data],
  );
  const visibleSongs = useMemo(() => shownSongs(songs, AS_GIVEN, songFilter), [songs, songFilter]);
  const fullAlbums = useMemo(
    () => uniqueSpotifyItems(artistAlbums.data?.pages.flatMap((albumPage) => albumPage.items) ?? []),
    [artistAlbums.data],
  );
  const singles = useMemo(
    () => uniqueSpotifyItems(artistSingles.data?.pages.flatMap((albumPage) => albumPage.items) ?? []),
    [artistSingles.data],
  );
  const { data: followed } = useSpotifyFollowed();
  const follow = useToggleSpotifyFollow();
  const tone = useTone(image(data?.artist.images, 64));
  usePageTone(tone);
  if (!on) return <NotConnected />;
  if (isLoading) return <PageSkeleton />;
  if (!data) return <SpotifyError what="artist" retry={() => void refetch()} />;
  const { artist } = data;
  const following = Boolean(followed?.some((a) => a.id === artist.id));
  const releaseQuery = section === "albums" ? artistAlbums : artistSingles;
  const releaseTotal = (artistAlbums.data?.pages[0]?.total ?? 0) + (artistSingles.data?.pages[0]?.total ?? 0);
  const context: PlayContext = { kind: "artist", id: spId(artist.id), name: artist.name };

  const sectionHref = (nextSection: string | null) => {
    const sectionParams = new URLSearchParams(searchParams);

    if (nextSection) sectionParams.set("section", nextSection);
    else sectionParams.delete("section");

    return `?${sectionParams.toString()}`;
  };

  return (
    <div className={section === "songs" ? "artist-page artist-songs-page" : "artist-page"}>
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="a-hero">
        <div className="bg">
          <Art images={artist.images} px={900} sizes="100vw" eager fallback="artist" />
        </div>
        <div className="a-hero-text">
          <div className="kind">
            <SpotifyMark /> Artist
          </div>
          <h1 style={{ "--title": `${artist.name.length > 14 ? 76 : 112}px` } as React.CSSProperties}>{artist.name}</h1>
          <p>
            {artist.followers ? `${count(artist.followers.total)} followers on Spotify. ` : ""}
            {releaseTotal ? `${plural(releaseTotal, "release")}.` : ""}
          </p>
        </div>
      </div>
      <ActBar>
        {songs.length || fullAlbums.length || singles.length ? (
          <>
            <PlayContextButton
              contextId={spId(artist.id)}
              label={artist.name}
              disabled={!songs.length}
              onPlay={() => player.playSongs(songs, 0, context)}
            />
            <ShuffleButton
              label={artist.name}
              disabled={!songs.length}
              onShuffle={() => player.playSongs(songs, 0, context, { shuffle: true })}
            />
          </>
        ) : null}
        <button
          type="button"
          className="btn ghost sm"
          aria-pressed={following}
          onClick={() => follow.mutate({ artist, on: !following })}
        >
          {following ? "Following" : "Follow"}
        </button>
        <OpenInSpotify kind="artist" id={artist.id} />
      </ActBar>
      <div className="pad">
        {section ? (
          <Link className="show-all artist-back" to={sectionHref(null)}>
            <Icon name="back" size={16} />
            Back to artist
          </Link>
        ) : null}
        {!section || section === "songs" ? (
          <section>
            <RowHeader
              title="Songs"
              subtitle={section ? "Spotify relevance. Search the songs loaded here." : "Spotify relevance"}
              action={
                <div className="collection-actions">
                  <SearchField
                    variant="inline"
                    collapsible
                    value={songFilter}
                    onChange={setSongFilter}
                    label="Find in artist songs"
                  />
                  {!section && (songs.length > 10 || artistSongs.hasNextPage) ? (
                    <Link className="show-all" to={sectionHref("songs")}>
                      Show all
                    </Link>
                  ) : null}
                </div>
              }
            />
            {blocked && !songs.length ? (
              <p className="muted">Songs will load after Spotify’s cooldown.</p>
            ) : artistSongs.isLoading ? (
              <p className="muted" role="status">
                Loading songs…
              </p>
            ) : artistSongs.isError && !songs.length ? (
              <div className="empty-inline">
                <p className="muted">Couldn’t load this artist’s songs from Spotify.</p>
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={blocked}
                  onClick={() => void artistSongs.refetch()}
                >
                  Try again
                </button>
              </div>
            ) : (
              <TrackList
                songs={visibleSongs}
                context={context}
                art
                album
                header={section === "songs"}
                {...(!section ? { limit: 10 } : {})}
                column={{ label: "Release date", value: releaseDateLabel }}
                canSort={false}
              />
            )}
            {section === "songs" && artistSongs.hasNextPage ? (
              <button
                type="button"
                className="btn ghost sm"
                disabled={blocked || artistSongs.isFetchingNextPage}
                onClick={() => void artistSongs.fetchNextPage()}
              >
                {artistSongs.isFetchingNextPage
                  ? "Loading…"
                  : artistSongs.isFetchNextPageError
                    ? "Try loading more again"
                    : "Load more"}
              </button>
            ) : null}
          </section>
        ) : null}
        {!section || section === "albums" ? (
          <Collection
            id="spotify-artist-albums"
            title="Albums"
            items={fullAlbums.map((album) => spotifyAlbumItem(album, releaseYear(album)))}
            sorts={RELEASE_SORTS}
            empty={blocked ? "Albums will load after Spotify’s cooldown." : "No albums here."}
            {...(artistAlbums.isLoading ? { loading: <CardSkeletons n={6} /> } : {})}
            {...(!section ? { preview: 6, to: sectionHref("albums") } : { subtitle: "Search the albums loaded here." })}
          />
        ) : null}
        {!section || section === "singles" ? (
          <Collection
            id="spotify-artist-singles"
            title="Singles and EPs"
            items={singles.map((album) => spotifyAlbumItem(album, releaseYear(album)))}
            sorts={RELEASE_SORTS}
            empty={blocked ? "Releases will load after Spotify’s cooldown." : "No singles or EPs here."}
            {...(artistSingles.isLoading ? { loading: <CardSkeletons n={6} /> } : {})}
            {...(!section
              ? { preview: 6, to: sectionHref("singles") }
              : { subtitle: "Search the releases loaded here." })}
          />
        ) : null}
        {(section === "albums" || section === "singles") && releaseQuery.hasNextPage ? (
          <button
            type="button"
            className="btn ghost sm"
            disabled={blocked || releaseQuery.isFetchingNextPage}
            onClick={() => void releaseQuery.fetchNextPage()}
          >
            {releaseQuery.isFetchingNextPage
              ? "Loading…"
              : releaseQuery.isFetchNextPageError
                ? "Try loading more again"
                : "Load more"}
          </button>
        ) : null}
        {(!section || section === "albums") && artistAlbums.isError && !fullAlbums.length ? (
          <button type="button" className="btn ghost sm" disabled={blocked} onClick={() => void artistAlbums.refetch()}>
            Try loading albums again
          </button>
        ) : null}
        {(!section || section === "singles") && artistSingles.isError && !singles.length ? (
          <button
            type="button"
            className="btn ghost sm"
            disabled={blocked}
            onClick={() => void artistSingles.refetch()}
          >
            Try loading singles and EPs again
          </button>
        ) : null}
      </div>
    </div>
  );
}
