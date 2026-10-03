import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { youtubeMusicLink } from "@needle/shared";
import type { Song } from "@needle/shared";
import { Art, LikedArt } from "../../../components/Art.tsx";
import { CardSkeletons, RowHeader } from "../../../components/Cards.tsx";
import {
  Collection,
  CollectionTools,
  releaseSorts,
} from "../../../components/Collection.tsx";
import {
  ActBar,
  Hero,
  PageSkeleton,
  PlayContextButton,
  ShuffleButton,
} from "../../../components/Hero.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { SearchField } from "../../../components/SearchField.tsx";
import { SourceMark } from "../../../components/SpotifyMark.tsx";
import { TrackList } from "../../../components/tracks/TrackList.tsx";
import { youtubeMusicAlbumItem } from "../components/YouTubeMusicCards.tsx";
import { YouTubeMusicNotice } from "../components/YouTubeMusicNotice.tsx";
import { api } from "../../../lib/api.ts";
import { longDuration, plural, releaseDateLabel } from "../../../lib/format.ts";
import { artistPath } from "../../../lib/paths.ts";
import { image } from "../../spotify/api/client.ts";
import { AS_GIVEN, shownSongs, songSorts } from "../../../lib/songs.ts";
import type { SongOrder } from "../../../lib/songs.ts";
import { useTone } from "../../../lib/tone.ts";
import { useYouTubeMusicStatus, ytm } from "../api/client.ts";
import { MobileBack } from "../../../layout/Mobile.tsx";
import { useIsMobile } from "../../../lib/media.ts";
import { usePageTone } from "../../../layout/pageTone.ts";
import { TopBar } from "../../../layout/TopBar.tsx";
import { player } from "../../../player/controller.ts";
import type { PlayContext } from "../../../player/store.ts";
import { useCapabilities } from "../../../queries/hooks.ts";
import {
  useToggleYouTubeMusicAlbum,
  useToggleYouTubeMusicFollow,
  useYouTubeMusicAlbum,
  useYouTubeMusicAlbums,
  useYouTubeMusicArtist,
  useYouTubeMusicArtists,
  useYouTubeMusicLiked,
  useYouTubeMusicOn,
  useYouTubeMusicPlaylist,
  useYouTubeMusicRequestsAllowed,
} from "../hooks/useYouTubeMusic.ts";
import { toast } from "../../../state/ui.ts";
import { useSession } from "../../../state/session.ts";
import { translate } from "../../../i18n/index.ts";

const totalDuration = (songs: Song[]) =>
  songs.reduce((seconds, song) => seconds + (song.duration ?? 0), 0);
const EMPTY_SONGS: Song[] = [];
const youtubeMusicSorts = () =>
  songSorts()
    .filter(([songSort]) => songSort !== "added")
    .map(([songSort, songLabel]): [typeof songSort, string] => [
      songSort,
      songSort === "custom" ? translate("youtube.order") : songLabel,
    ]);

function OpenInYouTubeMusic({
  kind,
  id,
}: {
  kind: "album" | "artist" | "playlist";
  id: string;
}) {
  return (
    <a
      className="icon-btn big"
      href={youtubeMusicLink(kind, id)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={translate("youtube.open")}
    >
      <Icon name="link" size={22} />
    </a>
  );
}

type YouTubeMusicItem = "album" | "artist" | "list" | "playlist";

function youtubeMusicItemLabel(
  youtubeMusicItem: YouTubeMusicItem | undefined,
): string {
  switch (youtubeMusicItem) {
    case "album":
      return translate("youtube.itemAlbum");
    case "artist":
      return translate("youtube.itemArtist");
    case "list":
      return translate("youtube.itemList");
    case "playlist":
      return translate("youtube.itemPlaylist");
    case undefined:
      return translate("youtube.item");
  }
}

function YouTubeMusicUnavailable({
  what,
  retry,
}: {
  what?: YouTubeMusicItem;
  retry?: () => void;
}) {
  const mobile = useIsMobile();
  const on = useYouTubeMusicOn();
  const capabilities = useCapabilities().data;

  return (
    <>
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="empty">
        <div className="empty-in">
          <h1>
            {on
              ? translate("youtube.loadItemFailed", {
                  item: youtubeMusicItemLabel(what),
                })
              : capabilities?.youtubeMusicConnected
                ? translate("youtube.switchedOff")
                : translate("youtube.connectFirst")}
          </h1>
          {on ? (
            <YouTubeMusicNotice error retry={retry} />
          ) : (
            <>
              <p>{translate("youtube.reconnectHint")}</p>
              <div className="acts">
                <Link to="/settings" className="btn primary">
                  {translate("empty.goSettings")}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function LoadMore({
  visible,
  busy,
  blocked,
  onMore,
}: {
  visible: boolean;
  busy: boolean;
  blocked: boolean;
  onMore: () => void;
}) {
  if (!visible) return null;

  return (
    <div className="yt-more">
      <button
        type="button"
        className="btn ghost sm"
        disabled={busy || blocked}
        onClick={onMore}
      >
        {translate(busy ? "search.loading" : "search.loadMore")}
      </button>
    </div>
  );
}

export function YouTubeMusicLikedPage() {
  const on = useYouTubeMusicOn();
  const blocked = useYouTubeMusicStatus((status) => status.blocked);
  const [limit, setLimit] = useState(100);
  const liked = useYouTubeMusicLiked(limit);
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<SongOrder>(AS_GIVEN);
  const songs = liked.data ?? EMPTY_SONGS;
  const visibleSongs = useMemo(
    () => shownSongs(songs, order, filter),
    [songs, order, filter],
  );

  usePageTone("#70332E");

  if (!on) return <YouTubeMusicUnavailable />;
  if (liked.isLoading) return <PageSkeleton />;
  if (!liked.data)
    return (
      <YouTubeMusicUnavailable what="list" retry={() => void liked.refetch()} />
    );

  const context: PlayContext = {
    kind: "liked",
    id: "ytm:liked",
    name: translate("youtube.liked"),
  };

  return (
    <div className="tinted">
      <Hero
        art={<LikedArt className="yt-liked" />}
        kind="YouTube Music"
        title={translate("home.likedYouTube")}
        meta={<span>{plural(liked.total ?? songs.length, "song")}</span>}
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
              sorts={youtubeMusicSorts()}
              order={order}
              onOrder={setOrder}
            />
          </>
        }
      >
        <PlayContextButton
          contextId="ytm:liked"
          label={translate("youtube.liked")}
          disabled={!visibleSongs.length}
          onPlay={() => player.playSongs(visibleSongs, 0, context)}
        />
        <ShuffleButton
          label={translate("youtube.liked")}
          disabled={!visibleSongs.length}
          onShuffle={() =>
            player.playSongs(visibleSongs, 0, context, { shuffle: true })
          }
        />
      </ActBar>
      <div className="pad yt-notice-wrap">
        <YouTubeMusicNotice
          error={liked.isError}
          retry={() => void liked.refetch()}
        />
      </div>
      <TrackList
        songs={visibleSongs}
        context={context}
        art
        album
        order={order}
        onOrder={setOrder}
        fallback={AS_GIVEN}
      />
      {!songs.length ? (
        <p className="pad muted">{translate("library.noLikedYouTube")}</p>
      ) : null}
      <LoadMore
        visible={liked.hasMore && limit < 3000}
        busy={liked.isFetching}
        blocked={blocked}
        onMore={() => setLimit(Math.min(limit + 100, 3000))}
      />
    </div>
  );
}

export function YouTubeMusicPlaylistPage() {
  const { id = "" } = useParams();
  const on = useYouTubeMusicOn();
  const blocked = useYouTubeMusicStatus((status) => status.blocked);
  const [limit, setLimit] = useState(100);
  const playlistQuery = useYouTubeMusicPlaylist(id, limit);
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<SongOrder>(AS_GIVEN);
  const songs = playlistQuery.data?.songs.items ?? EMPTY_SONGS;
  const visibleSongs = useMemo(
    () => shownSongs(songs, order, filter),
    [songs, order, filter],
  );
  const tone = useTone(image(playlistQuery.data?.playlist.images, 64));

  usePageTone(tone);

  if (!on) return <YouTubeMusicUnavailable />;
  if (playlistQuery.isLoading) return <PageSkeleton />;
  if (!playlistQuery.data)
    return (
      <YouTubeMusicUnavailable
        what="playlist"
        retry={() => void playlistQuery.refetch()}
      />
    );

  const { playlist, songs: songPage } = playlistQuery.data;
  const context: PlayContext = {
    kind: "playlist",
    id: playlist.id,
    name: playlist.title,
  };

  return (
    <div className="tinted">
      <Hero
        art={<Art images={playlist.images} px={232} eager />}
        kind={translate("youtube.playlist")}
        title={playlist.title}
        description={playlist.description}
        meta={
          <>
            <b>{playlist.author}</b>
            <span>
              {plural(
                playlist.songCount ?? songPage.total ?? songs.length,
                "song",
              )}
              {songs.length ? `, ${longDuration(totalDuration(songs))}` : ""}
            </span>
          </>
        }
      />
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
                sorts={youtubeMusicSorts()}
                order={order}
                onOrder={setOrder}
              />
            </>
          ) : null
        }
      >
        <PlayContextButton
          contextId={playlist.id}
          label={playlist.title}
          disabled={!songs.length}
          onPlay={() => player.playSongs(songs, 0, context)}
        />
        <ShuffleButton
          label={playlist.title}
          disabled={!songs.length}
          onShuffle={() =>
            player.playSongs(songs, 0, context, { shuffle: true })
          }
        />
        <OpenInYouTubeMusic kind="playlist" id={playlist.id} />
      </ActBar>
      <div className="pad yt-notice-wrap">
        <YouTubeMusicNotice
          error={playlistQuery.isError}
          retry={() => void playlistQuery.refetch()}
        />
      </div>
      <TrackList
        songs={visibleSongs}
        context={context}
        art
        album
        order={order}
        onOrder={setOrder}
      />
      {!songs.length ? (
        <p className="pad muted">{translate("youtube.emptyPlaylist")}.</p>
      ) : null}
      <LoadMore
        visible={songPage.hasMore && limit < 3000}
        busy={playlistQuery.isFetching}
        blocked={blocked}
        onMore={() => setLimit(Math.min(limit + 100, 3000))}
      />
    </div>
  );
}

export function YouTubeMusicAlbumPage() {
  const { id = "" } = useParams();
  const on = useYouTubeMusicOn();
  const albumQuery = useYouTubeMusicAlbum(id);
  const savedAlbums = useYouTubeMusicAlbums(3000);
  const save = useToggleYouTubeMusicAlbum();
  const capabilities = useCapabilities().data;
  const blocked = useYouTubeMusicStatus((status) => status.blocked);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [order, setOrder] = useState<SongOrder>(AS_GIVEN);
  const songs = albumQuery.data?.songs ?? EMPTY_SONGS;
  const visibleSongs = useMemo(
    () => shownSongs(songs, order, filter),
    [songs, order, filter],
  );
  const tone = useTone(image(albumQuery.data?.album.images, 64));

  usePageTone(tone);

  if (!on) return <YouTubeMusicUnavailable />;
  if (albumQuery.isLoading) return <PageSkeleton />;
  if (!albumQuery.data)
    return (
      <YouTubeMusicUnavailable
        what="album"
        retry={() => void albumQuery.refetch()}
      />
    );

  const { album } = albumQuery.data;
  const isSaved = Boolean(
    savedAlbums.data?.some((savedAlbum) => savedAlbum.id === album.id),
  );
  const savedMembershipKnown =
    Boolean(savedAlbums.data) && (isSaved || !savedAlbums.hasMore);
  const context: PlayContext = {
    kind: "album",
    id: album.id,
    name: album.title,
    ordered: true,
  };
  const getAlbum = async () => {
    setBusy(true);

    try {
      const { albums: matchingAlbums } = await api.lidarrSearch(
        `${album.artists[0]?.name ?? ""} ${album.title}`,
      );
      const matchingAlbum = matchingAlbums[0];

      if (!matchingAlbum) toast(translate("menu.lidarrNotFound"));
      else {
        await api.lidarrGet(matchingAlbum.foreignAlbumId);

        toast(translate("menu.lidarrLooking", { title: matchingAlbum.title }));
      }
    } catch (requestError) {
      toast(
        requestError instanceof Error
          ? requestError.message
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
        kind={translate("youtube.albumKind")}
        title={album.title}
        description={album.description}
        meta={
          <>
            {album.artists.map((artist) => (
              <Link
                key={artist.id}
                to={artistPath(artist.id)}
                className="meta-artist"
              >
                {artist.name}
              </Link>
            ))}
            {album.year ? <span>{album.year}</span> : null}
            <span>
              {plural(songs.length, "song")},{" "}
              {longDuration(totalDuration(songs))}
            </span>
          </>
        }
      />
      <ActBar
        end={
          <SearchField
            variant="inline"
            collapsible
            value={filter}
            onChange={setFilter}
            label={translate("catalog.findAlbum")}
          />
        }
      >
        <PlayContextButton
          contextId={album.id}
          label={album.title}
          disabled={!songs.length}
          onPlay={() => player.playSongs(songs, 0, context)}
        />
        <ShuffleButton
          label={album.title}
          disabled={!songs.length}
          onShuffle={() =>
            player.playSongs(songs, 0, context, { shuffle: true })
          }
        />
        <button
          type="button"
          className="icon-btn big"
          disabled={blocked || !savedMembershipKnown || save.isPending}
          aria-pressed={savedMembershipKnown ? isSaved : undefined}
          aria-label={
            !savedMembershipKnown
              ? translate("youtube.libraryStatusUnavailable")
              : isSaved
                ? translate("youtube.removeLibrary")
                : translate("youtube.saveLibrary")
          }
          onClick={() => save.mutate({ album, on: !isSaved })}
        >
          <Icon name={isSaved ? "heartFill" : "heart"} size={28} />
        </button>
        {capabilities?.lidarr ? (
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy}
            onClick={() => void getAlbum()}
          >
            <Icon name="download" size={15} />
            {translate(busy ? "youtube.lidarrAsking" : "get.album")}
          </button>
        ) : null}
        <OpenInYouTubeMusic kind="album" id={album.id} />
      </ActBar>
      <div className="pad yt-notice-wrap">
        <YouTubeMusicNotice
          error={albumQuery.isError}
          retry={() => void albumQuery.refetch()}
        />
      </div>
      <TrackList
        songs={visibleSongs}
        context={context}
        numbers="track"
        order={order}
        onOrder={setOrder}
        onPlay={(songIndex) => {
          const selectedSong = visibleSongs[songIndex];

          if (selectedSong)
            player.playSongs(songs, songs.indexOf(selectedSong), context);
        }}
      />
    </div>
  );
}

export function YouTubeMusicArtistPage() {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const section = searchParams.get("section");
  const on = useYouTubeMusicOn();
  const requestsAllowed = useYouTubeMusicRequestsAllowed();
  const blocked = useYouTubeMusicStatus((status) => status.blocked);
  const mobile = useIsMobile();
  const artistQuery = useYouTubeMusicArtist(id);
  const followedArtists = useYouTubeMusicArtists();
  const follow = useToggleYouTubeMusicFollow();
  const [songFilter, setSongFilter] = useState("");
  const [songLimit, setSongLimit] = useState(20);
  const [releaseLimit, setReleaseLimit] = useState(20);
  const user = useSession((session) => session.credentials?.user ?? "");
  const artistSongs = useQuery({
    queryKey: ["ytm", "artistSongs", id, songLimit, user],
    queryFn: () => ytm.artistSongs(id, songLimit),
    enabled: requestsAllowed && section === "songs" && songLimit > 20,
    placeholderData: (previousPage, previousQuery) =>
      previousQuery?.queryKey[2] === id && previousQuery.queryKey[4] === user
        ? previousPage
        : undefined,
  });
  const releaseKind = section === "singles" ? "singles" : "albums";
  const artistReleases = useQuery({
    queryKey: ["ytm", "artistReleases", id, releaseKind, releaseLimit, user],
    queryFn: () => ytm.artistReleases(id, releaseKind, releaseLimit),
    enabled:
      requestsAllowed &&
      (section === "albums" || section === "singles") &&
      releaseLimit > 20,
    placeholderData: (previousPage, previousQuery) =>
      previousQuery?.queryKey[2] === id &&
      previousQuery.queryKey[3] === releaseKind &&
      previousQuery.queryKey[5] === user
        ? previousPage
        : undefined,
  });
  const songs =
    artistSongs.data?.items ?? artistQuery.data?.songs ?? EMPTY_SONGS;
  const visibleSongs = useMemo(
    () => shownSongs(songs, AS_GIVEN, songFilter),
    [songs, songFilter],
  );
  const albums =
    section === "albums" && artistReleases.data
      ? artistReleases.data.items
      : (artistQuery.data?.albums ?? []);
  const singles =
    section === "singles" && artistReleases.data
      ? artistReleases.data.items
      : (artistQuery.data?.singles ?? []);
  const tone = useTone(image(artistQuery.data?.artist.images, 64));

  usePageTone(tone);

  if (!on) return <YouTubeMusicUnavailable />;
  if (artistQuery.isLoading) return <PageSkeleton />;
  if (!artistQuery.data)
    return (
      <YouTubeMusicUnavailable
        what="artist"
        retry={() => void artistQuery.refetch()}
      />
    );

  const { artist } = artistQuery.data;
  const artistInLibrary = Boolean(
    followedArtists.data?.some(
      (followedArtist) => followedArtist.id === artist.id,
    ),
  );
  const following = artist.subscribed ?? artistInLibrary;
  const followingKnown =
    artist.subscribed !== undefined ||
    artistInLibrary ||
    Boolean(followedArtists.data && !followedArtists.hasMore);
  const context: PlayContext = {
    kind: "artist",
    id: artist.id,
    name: artist.name,
  };
  const songHasMore =
    artistSongs.data?.hasMore ?? artistQuery.data.hasMoreSongs;
  const releaseHasMore =
    artistReleases.data?.hasMore ??
    (section === "albums"
      ? artistQuery.data.hasMoreAlbums
      : artistQuery.data.hasMoreSingles);
  const sectionHref = (artistSection: string | null) => {
    const sectionParams = new URLSearchParams(searchParams);

    if (artistSection) sectionParams.set("section", artistSection);
    else sectionParams.delete("section");

    return `?${sectionParams}`;
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
            <SourceMark source="youtubeMusic" /> {translate("spotify.artist")}
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
            {artist.subscribers
              ? translate("youtube.subscribers", {
                  subscribers: artist.subscribers,
                })
              : translate("youtube.artistKind")}
          </p>
        </div>
      </div>
      <ActBar>
        <PlayContextButton
          contextId={artist.id}
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
        <button
          type="button"
          className="btn ghost sm"
          disabled={
            blocked ||
            follow.isPending ||
            !followingKnown ||
            followedArtists.isLoading
          }
          aria-pressed={followingKnown ? following : undefined}
          onClick={() => follow.mutate({ artist, on: !following })}
        >
          {translate(
            !followingKnown
              ? "youtube.followStatusUnavailable"
              : following
                ? "youtube.following"
                : "youtube.follow",
          )}
        </button>
        <OpenInYouTubeMusic kind="artist" id={artist.id} />
      </ActBar>
      <div className="pad">
        <YouTubeMusicNotice
          error={
            artistQuery.isError || artistSongs.isError || artistReleases.isError
          }
          retry={() => {
            void artistQuery.refetch();
            if (section === "songs" && songLimit > 20)
              void artistSongs.refetch();
            if (
              (section === "albums" || section === "singles") &&
              releaseLimit > 20
            )
              void artistReleases.refetch();
          }}
        />
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
              subtitle={translate("youtube.relevance")}
              action={
                <div className="collection-actions">
                  <SearchField
                    variant="inline"
                    collapsible
                    value={songFilter}
                    onChange={setSongFilter}
                    label={translate("catalog.findArtistSongs")}
                  />
                  {!section && (songs.length > 10 || songHasMore) ? (
                    <Link className="show-all" to={sectionHref("songs")}>
                      {translate("common.showAll")}
                    </Link>
                  ) : null}
                </div>
              }
            />
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
            {section === "songs" ? (
              <LoadMore
                visible={songHasMore && songLimit < 3000}
                busy={artistSongs.isFetching}
                blocked={blocked}
                onMore={() => setSongLimit(Math.min(songLimit + 20, 3000))}
              />
            ) : null}
          </section>
        ) : null}
        {!section || section === "albums" ? (
          <Collection
            id="youtube-music-artist-albums"
            title={translate("catalog.albums")}
            items={albums.map((album) =>
              youtubeMusicAlbumItem(
                album,
                album.year ? String(album.year) : undefined,
              ),
            )}
            sorts={releaseSorts()}
            empty={translate("spotify.noAlbums")}
            {...(artistReleases.isLoading && section === "albums"
              ? { loading: <CardSkeletons n={6} /> }
              : {})}
            {...(!section ? { preview: 6, to: sectionHref("albums") } : {})}
          />
        ) : null}
        {!section || section === "singles" ? (
          <Collection
            id="youtube-music-artist-singles"
            title={translate("catalog.singlesEps")}
            items={singles.map((album) =>
              youtubeMusicAlbumItem(
                album,
                album.year ? String(album.year) : undefined,
              ),
            )}
            sorts={releaseSorts()}
            empty={translate("spotify.noSingles")}
            {...(!section ? { preview: 6, to: sectionHref("singles") } : {})}
          />
        ) : null}
        {section === "albums" || section === "singles" ? (
          <LoadMore
            visible={releaseHasMore && releaseLimit < 3000}
            busy={artistReleases.isFetching}
            blocked={blocked}
            onMore={() => setReleaseLimit(Math.min(releaseLimit + 20, 3000))}
          />
        ) : null}
        {!section && artist.description ? (
          <section className="yt-artist-about">
            <RowHeader title={translate("catalog.about")} />
            <p className="muted">{artist.description}</p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
