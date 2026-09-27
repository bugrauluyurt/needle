import { useQueries } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import type { Song } from "@needle/shared";
import { Art } from "../components/Art.tsx";
import { LikeButton } from "../components/Buttons.tsx";
import { albumItem, ArtistCard, CardRow, playArtist, RowHeader } from "../components/Cards.tsx";
import { Collection, RELEASE_SORTS } from "../components/Collection.tsx";
import { ArtistSearchCard } from "../components/GetCard.tsx";
import { ActBar, NotFoundState, PageSkeleton, PlayContextButton, ShuffleButton } from "../components/Hero.tsx";
import { Icon } from "../components/Icon.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { count, plural, releaseKind } from "../lib/format.ts";
import { sub } from "../lib/subsonic.ts";
import { useTone } from "../lib/tone.ts";
import { MobileBack } from "../layout/Mobile.tsx";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { player } from "../player/controller.ts";
import { keys } from "../queries/keys.ts";
import { useArtist, useArtistInfo, useCapabilities, useLidarrArtists, useStarredIds, useTopSongs } from "../queries/hooks.ts";
import { useArtistImage } from "../queries/spotify.ts";

const cleanBio = (html: string | undefined) => html?.replace(/<a [^>]*>.*?<\/a>\.?/gs, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() ?? "";


const POPULAR_FEW = 5;
const POPULAR_MORE = 10;

export default function ArtistPage() {
  const { id } = useParams();
  const mobile = useIsMobile();
  const { data: artist, isLoading, isError, error, refetch } = useArtist(id);
  const { data: info } = useArtistInfo(id);
  const { data: top = [] } = useTopSongs(artist?.name);
  const starred = useStarredIds();
  const caps = useCapabilities();
  const albums = useMemo(() => [...(artist?.album ?? [])].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)), [artist]);
  const fullAlbums = albums.filter((a) => releaseKind(a.songCount, a.duration) === "Album");
  const singles = albums.filter((a) => releaseKind(a.songCount, a.duration) !== "Album");
  const albumQueries = useQueries({
    queries: top.length >= 3 ? [] : albums.slice(0, 6).map((a) => ({ queryKey: keys.album(a.id), queryFn: () => sub.album(a.id), staleTime: 300_000 })),
  });
  const popular: Song[] = useMemo(() => {
    if (top.length >= 3) return top.slice(0, POPULAR_MORE);
    return albumQueries.flatMap((q) => q.data?.song ?? []).sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0)).slice(0, POPULAR_MORE);
  }, [top, albumQueries]);
  const inLibrary = (info?.similarArtist ?? []).filter((a) => a.id);
  const missingNames = (info?.similarArtist ?? []).filter((a) => !a.id).map((a) => a.name).slice(0, 6);
  const lidarrOn = Boolean(caps.data?.lidarr);
  const missing = useLidarrArtists(missingNames, lidarrOn);
  const banner = useArtistImage(artist?.id, artist?.name);
  const tone = useTone(banner ?? albums[0]?.coverArt);
  usePageTone(tone);
  const [showAllPopular, setShowAllPopular] = useState(false);

  if (isLoading) return <PageSkeleton />;
  if (isError || !artist) return <NotFoundState what="artist" error={error} retry={() => void refetch()} />;

  const songCount = albums.reduce((n, a) => n + a.songCount, 0);
  const plays = albums.reduce((n, a) => n + (a.playCount ?? 0), 0);
  const bio = cleanBio(info?.biography);
  const context = { kind: "artist" as const, id: artist.id, name: artist.name };

  return (
    <div className="artist-page">
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="a-hero">
        <div className="bg">
          <Art id={banner ?? albums[0]?.coverArt} px={900} eager fallback="artist" className={banner ? "" : "blurred"} />
        </div>
        <div className="a-hero-text">
          {starred.artists.has(artist.id) ? <div className="kind"><Icon name="heartFill" size={15} /> In your favourites</div> : null}
          <h1 style={{ "--title": `${artist.name.length > 14 ? 76 : 112}px` } as React.CSSProperties}>{artist.name}</h1>
          <p>
            {plural(albums.length, "album")}, {plural(songCount, "song")} in your library.
            {plays ? ` You’ve played them ${count(plays)} ${plays === 1 ? "time" : "times"}.` : ""}
          </p>
        </div>
      </div>
      <ActBar>
        <PlayContextButton contextId={artist.id} label={artist.name} onPlay={() => void playArtist(artist)} />
        <ShuffleButton label={artist.name} onShuffle={() => void playArtist(artist, true)} />
        <button type="button" className="btn ghost sm" onClick={() => void player.startRadio({ artistId: artist.id, name: artist.name })}>
          <Icon name="radio" size={15} />Artist radio
        </button>
        <LikeButton kind="artist" item={artist} />
      </ActBar>
      <div className={bio ? "a-grid with-about" : "a-grid"}>
        <section>
          <RowHeader title="Popular" action={popular.length > POPULAR_FEW ? <button type="button" className="show-all" onClick={() => setShowAllPopular(!showAllPopular)}>{showAllPopular ? "Show less" : "See more"}</button> : undefined} />
          {popular.length ? (
            <TrackList songs={popular} context={context} art header={false} limit={showAllPopular ? POPULAR_MORE : POPULAR_FEW} column={{ label: "Plays", value: (s) => (s.playCount ? count(s.playCount) : "") }} />
          ) : (
            <p className="muted">No plays yet. Popular songs appear as you listen.</p>
          )}
        </section>
        {bio ? (
          <section>
            <RowHeader title="About" />
            <div className="about">
              <p>{bio}</p>
              <p className="src">From Last.fm, through Navidrome</p>
            </div>
          </section>
        ) : null}
      </div>
      <div className="pad">
        {fullAlbums.length ? <Collection id="artist-albums" title="Albums" items={fullAlbums.map((a) => albumItem(a, [a.year, "Album"].filter(Boolean).join(", ")))} sorts={RELEASE_SORTS} /> : null}
        {singles.length ? <Collection id="artist-singles" title="Singles and EPs" items={singles.map((a) => albumItem(a, [a.year, releaseKind(a.songCount, a.duration)].filter(Boolean).join(", ")))} sorts={RELEASE_SORTS} /> : null}
        {inLibrary.length ? (
          <>
            <RowHeader title="Similar artists in your library" />
            <CardRow>{inLibrary.map((a) => <ArtistCard key={a.id} artist={a} />)}</CardRow>
          </>
        ) : null}
        {lidarrOn && missing.data?.length ? (
          <>
            <RowHeader title="Similar artists you don’t have" subtitle="Picked from Last.fm. Open one to find their albums and songs." />
            <div className="get">{missing.data.map((a) => <ArtistSearchCard key={a.foreignArtistId} artist={a} />)}</div>
          </>
        ) : null}
      </div>
    </div>
  );
}
