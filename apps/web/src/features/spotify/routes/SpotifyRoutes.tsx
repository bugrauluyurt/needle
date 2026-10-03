import { useMemo, useState } from "react";
import {
  Collection,
  CollectionTools,
  releaseSorts,
} from "../../../components/Collection.tsx";
import { SearchField } from "../../../components/SearchField.tsx";
import {
  AS_GIVEN,
  likedSorts,
  RECENT_FIRST,
  shownSongs,
  songSorts,
} from "../../../lib/songs.ts";
import type { SongOrder } from "../../../lib/songs.ts";
import { Link, useParams, useSearchParams } from "react-router";
import type { Song } from "@needle/shared";
import { Art, LikedArt } from "../../../components/Art.tsx";
import { CardSkeletons, RowHeader } from "../../../components/Cards.tsx";
import {
  ActBar,
  Hero,
  PageSkeleton,
  PlayContextButton,
  ShuffleButton,
} from "../../../components/Hero.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { TrackList } from "../../../components/tracks/TrackList.tsx";
import { api } from "../../../lib/api.ts";
import {
  ago,
  count,
  longDuration,
  localeCode,
  plain,
  plural,
  releaseDateLabel,
  releaseKind,
} from "../../../lib/format.ts";
import { artistPath } from "../../../lib/paths.ts";
import {
  image,
  sp,
  spId,
  spotifyLink,
  uniqueSpotifyItems,
  useSpotifyStatus,
} from "../api/client.ts";
import { releaseYear, spotifyAlbumItem } from "../components/SpotifyCards.tsx";
import { SpotifyMark } from "../../../components/SpotifyMark.tsx";
import { useTone } from "../../../lib/tone.ts";
import { useIsMobile } from "../../../lib/media.ts";
import { usePageTone } from "../../../layout/pageTone.ts";
import { MobileBack } from "../../../layout/Mobile.tsx";
import { TopBar } from "../../../layout/TopBar.tsx";
import { player } from "../../../player/controller.ts";
import type { PlayContext } from "../../../player/store.ts";
import { useCapabilities } from "../../../queries/hooks.ts";
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
} from "../hooks/useSpotify.ts";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "../../../state/ui.ts";
import { translate } from "../../../i18n/index.ts";

const duration = (songs: Song[]) =>
  songs.reduce((n, s) => n + (s.duration ?? 0), 0);

function OpenInSpotify({
  kind,
  id,
}: {
  kind: "album" | "artist" | "playlist";
  id: string;
}) {
  return (
    <a
      className="icon-btn big"
      href={spotifyLink(kind, id)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={translate("spotify.open")}
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
          <h1>{translate("spotify.connectFirst")}</h1>
          <p>{translate("spotify.connectHint")}</p>
          <div className="acts">
            <Link to="/settings" className="btn primary">
              {translate("empty.goSettings")}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

type SpotifyItem = "album" | "artist" | "list" | "playlist";

function spotifyItemLabel(spotifyItem: SpotifyItem): string {
  switch (spotifyItem) {
    case "album":
      return translate("spotify.itemAlbum");
    case "artist":
      return translate("spotify.itemArtist");
    case "list":
      return translate("spotify.itemList");
    case "playlist":
      return translate("spotify.itemPlaylist");
  }
}

function SpotifyError({
  what,
  retry,
}: {
  what: SpotifyItem;
  retry: () => void;
}) {
  const { blocked, until } = useSpotifyStatus();
  const mobile = useIsMobile();
  const item = spotifyItemLabel(what);
  return (
    <>
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="empty">
        <div className="empty-in">
          <h1>
            {blocked
              ? translate("spotify.paused")
              : translate("spotify.loadFailed", { item })}
          </h1>
          <p>
            {blocked
              ? translate("spotify.pausedHint", {
                  time: new Intl.DateTimeFormat(localeCode(), {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(until),
                })
              : translate("spotify.unavailableHint", { item })}
          </p>
          {!blocked ? (
            <div className="acts">
              <button type="button" className="btn primary" onClick={retry}>
                <Icon name="refresh" size={16} />
                {translate("common.retry")}
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
  const shown = useMemo(
    () => shownSongs(songs ?? [], order, filter),
    [songs, order, filter],
  );
  if (!on) return <NotConnected />;
  if (isLoading) return <PageSkeleton />;
  if (!songs) return <SpotifyError what="list" retry={() => void refetch()} />;
  const context: PlayContext = {
    kind: "liked",
    id: "sp:liked",
    name: translate("spotify.liked"),
  };
  return (
    <div className="tinted">
      <Hero
        art={<LikedArt className="sp-liked" />}
        kind="Spotify"
        title={translate("home.likedSpotify")}
        meta={<span>{plural(songs.length, "song")}</span>}
      />
      <ActBar
        end={
          <>
            <SearchField
              variant="inline"
              value={filter}
              onChange={setFilter}
              label={translate("library.findLikedSongs")}
            />
            <CollectionTools
              sorts={likedSorts()}
              order={order}
              onOrder={setOrder}
            />
          </>
        }
      >
        <PlayContextButton
          contextId="sp:liked"
          label={translate("spotify.liked")}
          onPlay={() => player.playSongs(shown, 0, context)}
        />
        <ShuffleButton
          label={translate("spotify.liked")}
          onShuffle={() =>
            player.playSongs(shown, 0, context, { shuffle: true })
          }
        />
      </ActBar>
      <TrackList
        songs={shown}
        context={context}
        art
        album
        column={{
          label: translate("sort.dateAdded"),
          value: (s) => ago(s.starred),
          sort: "added",
        }}
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
  const shown = useMemo(
    () => (data?.songs ? shownSongs(data.songs, order, filter) : null),
    [data, order, filter],
  );
  const tone = useTone(image(data?.meta.images, 64));
  usePageTone(tone);
  if (!on) return <NotConnected />;
  if (isLoading) return <PageSkeleton />;
  if (!data)
    return <SpotifyError what="playlist" retry={() => void refetch()} />;
  const { meta, songs } = data;
  const context: PlayContext = {
    kind: "playlist",
    id: spId(id),
    name: meta.name,
  };
  const total = meta.items?.total ?? meta.tracks?.total ?? songs?.length ?? 0;
  const editable =
    Boolean(mine) && songs !== null && order.key === "custom" && !filter;
  return (
    <div className="tinted">
      <Hero
        art={<Art images={meta.images} px={232} eager />}
        kind={translate(mine ? "spotify.playlist" : "spotify.followedPlaylist")}
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
                  label={translate("playlist.find")}
                />
                <CollectionTools
                  sorts={songSorts()}
                  order={order}
                  onOrder={setOrder}
                />
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
                onShuffle={() =>
                  player.playSongs(songs, 0, context, { shuffle: true })
                }
              />
            </>
          ) : null}
          <OpenInSpotify kind="playlist" id={id} />
        </ActBar>
      ) : null}
      {songs === null ? (
        <div className="pad sp-note">
          <h2>{translate("spotify.lockedHeading")}</h2>
          <p className="muted">{translate("spotify.lockedHint")}</p>
          <a
            className="btn light"
            href={spotifyLink("playlist", id)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="link" size={16} />
            {translate("spotify.open")}
          </a>
        </div>
      ) : songs.length && shown ? (
        <TrackList
          songs={shown}
          context={context}
          art
          album
          column={{
            label: translate("sort.dateAdded"),
            value: (s) => ago(s.created),
            sort: "added",
          }}
          order={order}
          onOrder={setOrder}
          {...(editable
            ? {
                onReorder: (from: number, to: number) =>
                  void edits.reorder(id, from, to),
                menuExtra: (s: Song) => [
                  {
                    label: translate("playlist.remove"),
                    icon: "trash" as const,
                    run: () => void edits.remove(id, s),
                  },
                ],
              }
            : {})}
        />
      ) : (
        <div className="pad empty-inline">
          <h2>{translate("spotify.emptyPlaylist")}</h2>
          <p className="muted">{translate("spotify.emptyPlaylistHint")}</p>
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
  const context: PlayContext = {
    kind: "album",
    id: spId(album.id),
    name: album.name,
    ordered: true,
  };
  const isSaved = Boolean(saved?.some((a) => a.id === album.id));
  const year = album.release_date?.slice(0, 4);
  const toggleSave = async () => {
    const uri = album.uri ?? `spotify:album:${album.id}`;
    try {
      await (isSaved ? sp.unsave([uri]) : sp.save([uri]));
      await qc.invalidateQueries({ queryKey: spKeys.albums });
      toast(
        translate(isSaved ? "spotify.removedLibrary" : "spotify.savedLibrary"),
      );
    } catch {
      toast(translate("spotify.updateFailed"));
    }
  };
  const getAlbum = async () => {
    setBusy(true);
    try {
      const {
        albums: [hit],
      } = await api.lidarrSearch(
        `${album.artists?.[0]?.name ?? ""} ${album.name}`,
      );
      if (!hit) toast(translate("menu.lidarrNotFound"));
      else {
        await api.lidarrGet(hit.foreignAlbumId);
        toast(translate("menu.lidarrLooking", { title: hit.title }));
      }
    } catch (e) {
      toast(
        e instanceof Error
          ? e.message
          : translate("settings.lidarrRequestFailed"),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tinted">
      <Hero
        art={<Art images={album.images} px={232} eager />}
        kind={translate("spotify.albumKind", {
          kind:
            album.album_type === "album"
              ? translate("catalog.album")
              : album.album_type === "compilation"
                ? translate("catalog.compilation")
                : releaseKind(songs.length, duration(songs)),
        })}
        title={album.name}
        meta={
          <>
            {(album.artists ?? []).map((a) => (
              <Link
                key={a.id}
                to={artistPath(spId(a.id))}
                className="meta-artist"
              >
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
          <SearchField
            variant="inline"
            collapsible
            value={songFilter}
            onChange={setSongFilter}
            label={translate("catalog.findAlbum")}
          />
        }
      >
        <PlayContextButton
          contextId={context.id ?? ""}
          label={album.name}
          onPlay={() => player.playSongs(songs, 0, context)}
        />
        <ShuffleButton
          label={album.name}
          onShuffle={() =>
            player.playSongs(songs, 0, context, { shuffle: true })
          }
        />
        <button
          type="button"
          className="icon-btn big"
          aria-pressed={isSaved}
          aria-label={
            isSaved
              ? translate("spotify.removeLibrary")
              : translate("spotify.saveLibrary")
          }
          onClick={() => void toggleSave()}
        >
          <Icon name={isSaved ? "heartFill" : "heart"} size={28} />
        </button>
        {caps.data?.lidarr ? (
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy}
            onClick={() => void getAlbum()}
          >
            <Icon name="download" size={15} />
            {translate(busy ? "settings.askingLidarr" : "spotify.getAlbum")}
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

          if (selectedSong)
            player.playSongs(songs, songs.indexOf(selectedSong), context);
        }}
      />
      <div className="pad">
        {album.label || album.copyrights?.[0] ? (
          <p className="album-foot muted">
            {[year, album.label, album.copyrights?.[0]?.text]
              .filter(Boolean)
              .join(". ")}
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
    artistSection === "songs" ||
    artistSection === "albums" ||
    artistSection === "singles"
      ? artistSection
      : null;
  const [songFilter, setSongFilter] = useState("");
  const on = useSpotifyOn();
  const blocked = useSpotifyStatus((s) => s.blocked);
  const mobile = useIsMobile();
  const { data, isLoading, refetch } = useSpotifyArtist(id);
  const artistSongs = useSpotifyArtistSongs(
    data?.artist.id ?? "",
    data?.artist.name ?? "",
  );
  const artistAlbums = useSpotifyArtistAlbums(
    data?.artist.id ?? "",
    undefined,
    "album",
  );
  const artistSingles = useSpotifyArtistAlbums(
    data?.artist.id ?? "",
    undefined,
    "single",
  );
  const songs = useMemo(
    () =>
      uniqueSpotifyItems(
        artistSongs.data?.pages.flatMap((songPage) => songPage.items) ?? [],
      ),
    [artistSongs.data],
  );
  const visibleSongs = useMemo(
    () => shownSongs(songs, AS_GIVEN, songFilter),
    [songs, songFilter],
  );
  const fullAlbums = useMemo(
    () =>
      uniqueSpotifyItems(
        artistAlbums.data?.pages.flatMap((albumPage) => albumPage.items) ?? [],
      ),
    [artistAlbums.data],
  );
  const singles = useMemo(
    () =>
      uniqueSpotifyItems(
        artistSingles.data?.pages.flatMap((albumPage) => albumPage.items) ?? [],
      ),
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
  const releaseTotal =
    (artistAlbums.data?.pages[0]?.total ?? 0) +
    (artistSingles.data?.pages[0]?.total ?? 0);
  const context: PlayContext = {
    kind: "artist",
    id: spId(artist.id),
    name: artist.name,
  };

  const sectionHref = (nextSection: string | null) => {
    const sectionParams = new URLSearchParams(searchParams);

    if (nextSection) sectionParams.set("section", nextSection);
    else sectionParams.delete("section");

    return `?${sectionParams.toString()}`;
  };

  return (
    <div
      className={
        section === "songs" ? "artist-page artist-songs-page" : "artist-page"
      }
    >
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="a-hero">
        <div className="bg">
          <Art
            images={artist.images}
            px={900}
            sizes="100vw"
            eager
            fallback="artist"
          />
        </div>
        <div className="a-hero-text">
          <div className="kind">
            <SpotifyMark /> {translate("spotify.artist")}
          </div>
          <h1
            style={
              {
                "--title": `${artist.name.length > 14 ? 76 : 112}px`,
              } as React.CSSProperties
            }
          >
            {artist.name}
          </h1>
          <p>
            {artist.followers
              ? `${translate("spotify.followers", {
                  followers: count(artist.followers.total),
                })} `
              : ""}
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
              onShuffle={() =>
                player.playSongs(songs, 0, context, { shuffle: true })
              }
            />
          </>
        ) : null}
        <button
          type="button"
          className="btn ghost sm"
          aria-pressed={following}
          onClick={() => follow.mutate({ artist, on: !following })}
        >
          {translate(following ? "spotify.following" : "spotify.follow")}
        </button>
        <OpenInSpotify kind="artist" id={artist.id} />
      </ActBar>
      <div className="pad">
        {section ? (
          <Link className="show-all artist-back" to={sectionHref(null)}>
            <Icon name="back" size={16} />
            {translate("spotify.backArtist")}
          </Link>
        ) : null}
        {!section || section === "songs" ? (
          <section>
            <RowHeader
              title={translate("catalog.songs")}
              subtitle={
                section
                  ? translate("spotify.relevanceHint")
                  : translate("spotify.relevance")
              }
              action={
                <div className="collection-actions">
                  <SearchField
                    variant="inline"
                    collapsible
                    value={songFilter}
                    onChange={setSongFilter}
                    label={translate("catalog.findArtistSongs")}
                  />
                  {!section &&
                  (songs.length > 10 || artistSongs.hasNextPage) ? (
                    <Link className="show-all" to={sectionHref("songs")}>
                      {translate("common.showAll")}
                    </Link>
                  ) : null}
                </div>
              }
            />
            {blocked && !songs.length ? (
              <p className="muted">{translate("spotify.songsCooldown")}</p>
            ) : artistSongs.isLoading ? (
              <p className="muted" role="status">
                {translate("spotify.loadingSongs")}
              </p>
            ) : artistSongs.isError && !songs.length ? (
              <div className="empty-inline">
                <p className="muted">{translate("spotify.songsError")}</p>
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={blocked}
                  onClick={() => void artistSongs.refetch()}
                >
                  {translate("common.retry")}
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
                column={{
                  label: translate("catalog.releaseDate"),
                  value: releaseDateLabel,
                }}
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
                  ? translate("common.loading")
                  : artistSongs.isFetchNextPageError
                    ? translate("spotify.tryLoadMore")
                    : translate("search.loadMore")}
              </button>
            ) : null}
          </section>
        ) : null}
        {!section || section === "albums" ? (
          <Collection
            id="spotify-artist-albums"
            title={translate("catalog.albums")}
            items={fullAlbums.map((album) =>
              spotifyAlbumItem(album, releaseYear(album)),
            )}
            sorts={releaseSorts()}
            empty={translate(
              blocked ? "spotify.albumsCooldown" : "spotify.noAlbums",
            )}
            {...(artistAlbums.isLoading
              ? { loading: <CardSkeletons n={6} /> }
              : {})}
            {...(!section
              ? { preview: 6, to: sectionHref("albums") }
              : { subtitle: translate("spotify.searchAlbums") })}
          />
        ) : null}
        {!section || section === "singles" ? (
          <Collection
            id="spotify-artist-singles"
            title={translate("catalog.singlesEps")}
            items={singles.map((album) =>
              spotifyAlbumItem(album, releaseYear(album)),
            )}
            sorts={releaseSorts()}
            empty={translate(
              blocked ? "spotify.releasesCooldown" : "spotify.noSingles",
            )}
            {...(artistSingles.isLoading
              ? { loading: <CardSkeletons n={6} /> }
              : {})}
            {...(!section
              ? { preview: 6, to: sectionHref("singles") }
              : { subtitle: translate("spotify.searchReleases") })}
          />
        ) : null}
        {(section === "albums" || section === "singles") &&
        releaseQuery.hasNextPage ? (
          <button
            type="button"
            className="btn ghost sm"
            disabled={blocked || releaseQuery.isFetchingNextPage}
            onClick={() => void releaseQuery.fetchNextPage()}
          >
            {releaseQuery.isFetchingNextPage
              ? translate("common.loading")
              : releaseQuery.isFetchNextPageError
                ? translate("spotify.tryLoadMore")
                : translate("search.loadMore")}
          </button>
        ) : null}
        {(!section || section === "albums") &&
        artistAlbums.isError &&
        !fullAlbums.length ? (
          <button
            type="button"
            className="btn ghost sm"
            disabled={blocked}
            onClick={() => void artistAlbums.refetch()}
          >
            {translate("spotify.loadAlbums")}
          </button>
        ) : null}
        {(!section || section === "singles") &&
        artistSingles.isError &&
        !singles.length ? (
          <button
            type="button"
            className="btn ghost sm"
            disabled={blocked}
            onClick={() => void artistSingles.refetch()}
          >
            {translate("spotify.loadSingles")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
