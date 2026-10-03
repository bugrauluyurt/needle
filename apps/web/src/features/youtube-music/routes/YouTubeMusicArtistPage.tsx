import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import { Art } from "../../../components/Art.tsx";
import { CardSkeletons, RowHeader } from "../../../components/Cards.tsx";
import { Collection, releaseSorts } from "../../../components/Collection.tsx";
import { ActBar, PageSkeleton, PlayContextButton, ShuffleButton } from "../../../components/Hero.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { SearchField } from "../../../components/SearchField.tsx";
import { SourceMark } from "../../../components/SpotifyMark.tsx";
import { TrackList } from "../../../components/tracks/TrackList.tsx";
import { youtubeMusicAlbumItem } from "../components/YouTubeMusicCards.tsx";
import { YouTubeMusicNotice } from "../components/YouTubeMusicNotice.tsx";
import { releaseDateLabel } from "../../../lib/format.ts";
import { useIsMobile } from "../../../lib/media.ts";
import { AS_GIVEN, shownSongs } from "../../../lib/songs.ts";
import { image } from "../../spotify/api/client.ts";
import { useTone } from "../../../lib/tone.ts";
import { useYouTubeMusicStatus, ytm } from "../api/client.ts";
import { MobileBack } from "../../../layout/Mobile.tsx";
import { usePageTone } from "../../../layout/pageTone.ts";
import { TopBar } from "../../../layout/TopBar.tsx";
import { player } from "../../../player/controller.ts";
import type { PlayContext } from "../../../player/store.ts";
import {
  useToggleYouTubeMusicFollow,
  useYouTubeMusicArtist,
  useYouTubeMusicArtists,
  useYouTubeMusicOn,
  useYouTubeMusicRequestsAllowed,
} from "../hooks/useYouTubeMusic.ts";
import { useSession } from "../../../state/session.ts";
import { translate } from "../../../i18n/index.ts";
import { EMPTY_SONGS, LoadMore, OpenInYouTubeMusic, YouTubeMusicUnavailable } from "./YouTubeMusicRouteState.tsx";

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
      previousQuery?.queryKey[2] === id && previousQuery.queryKey[4] === user ? previousPage : undefined,
  });
  const releaseKind = section === "singles" ? "singles" : "albums";
  const artistReleases = useQuery({
    queryKey: ["ytm", "artistReleases", id, releaseKind, releaseLimit, user],
    queryFn: () => ytm.artistReleases(id, releaseKind, releaseLimit),
    enabled: requestsAllowed && (section === "albums" || section === "singles") && releaseLimit > 20,
    placeholderData: (previousPage, previousQuery) =>
      previousQuery?.queryKey[2] === id &&
      previousQuery.queryKey[3] === releaseKind &&
      previousQuery.queryKey[5] === user
        ? previousPage
        : undefined,
  });
  const songs = artistSongs.data?.items ?? artistQuery.data?.songs ?? EMPTY_SONGS;
  const visibleSongs = useMemo(() => shownSongs(songs, AS_GIVEN, songFilter), [songs, songFilter]);
  const albums =
    section === "albums" && artistReleases.data ? artistReleases.data.items : (artistQuery.data?.albums ?? []);
  const singles =
    section === "singles" && artistReleases.data ? artistReleases.data.items : (artistQuery.data?.singles ?? []);
  const tone = useTone(image(artistQuery.data?.artist.images, 64));

  usePageTone(tone);

  if (!on) return <YouTubeMusicUnavailable />;
  if (artistQuery.isLoading) return <PageSkeleton />;
  if (!artistQuery.data) return <YouTubeMusicUnavailable what="artist" retry={() => void artistQuery.refetch()} />;

  const { artist } = artistQuery.data;
  const artistInLibrary = Boolean(followedArtists.data?.some((followedArtist) => followedArtist.id === artist.id));
  const following = artist.subscribed ?? artistInLibrary;
  const followingKnown =
    artist.subscribed !== undefined || artistInLibrary || Boolean(followedArtists.data && !followedArtists.hasMore);
  const context: PlayContext = {
    kind: "artist",
    id: artist.id,
    name: artist.name,
  };
  const songHasMore = artistSongs.data?.hasMore ?? artistQuery.data.hasMoreSongs;
  const releaseHasMore =
    artistReleases.data?.hasMore ??
    (section === "albums" ? artistQuery.data.hasMoreAlbums : artistQuery.data.hasMoreSingles);
  const sectionHref = (artistSection: string | null) => {
    const sectionParams = new URLSearchParams(searchParams);

    if (artistSection) sectionParams.set("section", artistSection);
    else sectionParams.delete("section");

    return `?${sectionParams}`;
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
          onShuffle={() => player.playSongs(songs, 0, context, { shuffle: true })}
        />
        <button
          type="button"
          className="btn ghost sm"
          disabled={blocked || follow.isPending || !followingKnown || followedArtists.isLoading}
          aria-pressed={followingKnown ? following : undefined}
          onClick={() => follow.mutate({ artist, on: !following })}
        >
          {translate(
            !followingKnown ? "youtube.followStatusUnavailable" : following ? "youtube.following" : "youtube.follow",
          )}
        </button>
        <OpenInYouTubeMusic kind="artist" id={artist.id} />
      </ActBar>
      <div className="pad">
        <YouTubeMusicNotice
          error={artistQuery.isError || artistSongs.isError || artistReleases.isError}
          retry={() => {
            void artistQuery.refetch();
            if (section === "songs" && songLimit > 20) void artistSongs.refetch();
            if ((section === "albums" || section === "singles") && releaseLimit > 20) void artistReleases.refetch();
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
            items={albums.map((album) => youtubeMusicAlbumItem(album, album.year ? String(album.year) : undefined))}
            sorts={releaseSorts()}
            empty={translate("spotify.noAlbums")}
            {...(artistReleases.isLoading && section === "albums" ? { loading: <CardSkeletons n={6} /> } : {})}
            {...(!section ? { preview: 6, to: sectionHref("albums") } : {})}
          />
        ) : null}
        {!section || section === "singles" ? (
          <Collection
            id="youtube-music-artist-singles"
            title={translate("catalog.singlesEps")}
            items={singles.map((album) => youtubeMusicAlbumItem(album, album.year ? String(album.year) : undefined))}
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
