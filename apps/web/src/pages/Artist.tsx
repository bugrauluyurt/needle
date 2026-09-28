import { useQueries } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { count, paragraphs, plainBio, plural, releaseKind } from "../lib/format.ts";
import { sub } from "../lib/subsonic.ts";
import { useTone } from "../lib/tone.ts";
import { MobileBack } from "../layout/Mobile.tsx";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { player } from "../player/controller.ts";
import { keys } from "../queries/keys.ts";
import { useArtist, useArtistInfo, useArtists, useCapabilities, useLidarrArtists, useStarredIds, useTopSongs } from "../queries/hooks.ts";
import { useArtistImage } from "../queries/spotify.ts";

const BIO_SOURCE = "From Last.fm, through Navidrome";

function About({ name, bio }: { name: string; bio: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setLong(el.scrollHeight > el.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [bio]);
  return (
    <section>
      <RowHeader title="About" />
      <div className="about">
        <p ref={ref} className="about-text">{bio}</p>
        <div className="about-foot">
          <span className="src">{BIO_SOURCE}</span>
          {long ? <button type="button" className="show-all" onClick={() => setOpen(true)}>Read more</button> : null}
        </div>
      </div>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="scrim" />
          <Dialog.Content className="dialog about-dialog" aria-describedby={undefined}>
            <div className="dialog-head">
              <Dialog.Title className="dialog-title small">About {name}</Dialog.Title>
              <Dialog.Close className="icon-btn" aria-label="Close"><Icon name="close" /></Dialog.Close>
            </div>
            <div className="about-full">{paragraphs(bio).map((p) => <p key={p}>{p}</p>)}</div>
            <p className="src">{BIO_SOURCE}</p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}

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
  const { data: library } = useArtists();
  const known = useMemo(() => new Set((library ?? []).map((a) => a.id)), [library]);
  const similar = info?.similarArtist ?? [];
  const inLibrary = similar.filter((a) => known.has(a.id));
  const missingNames = similar.filter((a) => !known.has(a.id)).map((a) => a.name).slice(0, 6);
  const lidarrOn = Boolean(caps.data?.lidarr);
  const missing = useLidarrArtists(missingNames, lidarrOn);
  const banner = useArtistImage(artist?.id, artist?.name);
  const tone = useTone(banner ?? albums[0]?.coverArt);
  usePageTone(tone);
  const [showAllPopular, setShowAllPopular] = useState(false);

  if (isLoading) return <PageSkeleton />;
  if (isError || !artist || !albums.length) return <NotFoundState what="artist" error={error} retry={() => void refetch()} name={artist?.name} />;

  const songCount = albums.reduce((n, a) => n + a.songCount, 0);
  const plays = albums.reduce((n, a) => n + (a.playCount ?? 0), 0);
  const bio = plainBio(info?.biography);
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
        {bio ? <About name={artist.name} bio={bio} /> : null}
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
