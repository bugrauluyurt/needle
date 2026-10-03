import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Art } from "../../../components/Art.tsx";
import { CardSkeletons, RowHeader } from "../../../components/Cards.tsx";
import { Collection, releaseSorts } from "../../../components/Collection.tsx";
import { ActBar, PageSkeleton, PlayContextButton, ShuffleButton } from "../../../components/Hero.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { SearchField } from "../../../components/SearchField.tsx";
import { SpotifyMark } from "../../../components/SpotifyMark.tsx";
import { TrackList } from "../../../components/tracks/TrackList.tsx";
import { count, plural, releaseDateLabel } from "../../../lib/format.ts";
import { useIsMobile } from "../../../lib/media.ts";
import { AS_GIVEN, shownSongs } from "../../../lib/songs.ts";
import { useTone } from "../../../lib/tone.ts";
import { image, spId, uniqueSpotifyItems, useSpotifyStatus } from "../api/client.ts";
import { releaseYear, spotifyAlbumItem } from "../components/SpotifyCards.tsx";
import { MobileBack } from "../../../layout/Mobile.tsx";
import { usePageTone } from "../../../layout/pageTone.ts";
import { TopBar } from "../../../layout/TopBar.tsx";
import { player } from "../../../player/controller.ts";
import type { PlayContext } from "../../../player/store.ts";
import {
  useSpotifyArtist,
  useSpotifyArtistAlbums,
  useSpotifyArtistSongs,
  useSpotifyFollowed,
  useSpotifyOn,
  useToggleSpotifyFollow,
} from "../hooks/useSpotify.ts";
import { translate } from "../../../i18n/index.ts";
import { NotConnected, OpenInSpotify, SpotifyError } from "./SpotifyRouteState.tsx";

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
    <div className={section === "songs" ? "artist-page artist-songs-page" : "artist-page"}>
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="a-hero">
        <div className="bg">
          <Art images={artist.images} px={900} sizes="100vw" eager fallback="artist" />
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
              subtitle={section ? translate("spotify.relevanceHint") : translate("spotify.relevance")}
              action={
                <div className="collection-actions">
                  <SearchField
                    variant="inline"
                    collapsible
                    value={songFilter}
                    onChange={setSongFilter}
                    label={translate("catalog.findArtistSongs")}
                  />
                  {!section && (songs.length > 10 || artistSongs.hasNextPage) ? (
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
            items={fullAlbums.map((album) => spotifyAlbumItem(album, releaseYear(album)))}
            sorts={releaseSorts()}
            empty={translate(blocked ? "spotify.albumsCooldown" : "spotify.noAlbums")}
            {...(artistAlbums.isLoading ? { loading: <CardSkeletons n={6} /> } : {})}
            {...(!section
              ? { preview: 6, to: sectionHref("albums") }
              : { subtitle: translate("spotify.searchAlbums") })}
          />
        ) : null}
        {!section || section === "singles" ? (
          <Collection
            id="spotify-artist-singles"
            title={translate("catalog.singlesEps")}
            items={singles.map((album) => spotifyAlbumItem(album, releaseYear(album)))}
            sorts={releaseSorts()}
            empty={translate(blocked ? "spotify.releasesCooldown" : "spotify.noSingles")}
            {...(artistSingles.isLoading ? { loading: <CardSkeletons n={6} /> } : {})}
            {...(!section
              ? { preview: 6, to: sectionHref("singles") }
              : { subtitle: translate("spotify.searchReleases") })}
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
              ? translate("common.loading")
              : releaseQuery.isFetchNextPageError
                ? translate("spotify.tryLoadMore")
                : translate("search.loadMore")}
          </button>
        ) : null}
        {(!section || section === "albums") && artistAlbums.isError && !fullAlbums.length ? (
          <button type="button" className="btn ghost sm" disabled={blocked} onClick={() => void artistAlbums.refetch()}>
            {translate("spotify.loadAlbums")}
          </button>
        ) : null}
        {(!section || section === "singles") && artistSingles.isError && !singles.length ? (
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
