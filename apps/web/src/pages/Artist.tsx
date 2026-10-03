import * as Dialog from "@radix-ui/react-dialog";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Art } from "../components/Art.tsx";
import { LikeButton } from "../components/Buttons.tsx";
import { albumItem, ArtistCard, CardRow, RowHeader } from "../components/Cards.tsx";
import { Collection, CollectionTools, RELEASE_SORTS } from "../components/Collection.tsx";
import type { SortOption } from "../components/Collection.tsx";
import { ArtistSearchCard } from "../components/GetCard.tsx";
import { ActBar, NotFoundState, PageSkeleton, PlayContextButton, ShuffleButton } from "../components/Hero.tsx";
import { Icon } from "../components/Icon.tsx";
import { SearchField } from "../components/SearchField.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { count, paragraphs, plainBio, plural, releaseDateLabel, releaseKind } from "../lib/format.ts";
import { shownSongs } from "../lib/songs.ts";
import type { SongOrder, SongSort } from "../lib/songs.ts";
import { useTone } from "../lib/tone.ts";
import { MobileBack } from "../layout/Mobile.tsx";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { player } from "../player/controller.ts";
import { useArtist, useArtistInfo, useArtists, useCapabilities, useLidarrArtists, useLibrarySongs, useStarredIds } from "../queries/hooks.ts";
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

const SONG_PREVIEW = 10;
const MOST_PLAYED: SongOrder = { key: "plays", desc: true };
const ARTIST_SONG_SORTS: [SongSort, string][] = [["plays", "Most played"], ["year", "Release date"], ["title", "Title"], ["album", "Album"]];
const ARTIST_RELEASE_SORTS: SortOption[] = [...RELEASE_SORTS, ["plays", "Most played"]];

export default function ArtistPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const artistSection = searchParams.get("section");
  const section = artistSection === "songs" || artistSection === "albums" || artistSection === "singles" ? artistSection : null;
  const [songFilter, setSongFilter] = useState("");
  const [songOrder, setSongOrder] = useState<SongOrder>(MOST_PLAYED);
  const mobile = useIsMobile();
  const { data: artist, isLoading, isError, error, refetch } = useArtist(id);
  const { data: info } = useArtistInfo(id);
  const librarySongs = useLibrarySongs(Boolean(id));
  const starred = useStarredIds();
  const caps = useCapabilities();
  const albums = useMemo(() => [...(artist?.album ?? [])].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)), [artist]);
  const fullAlbums = albums.filter((a) => releaseKind(a.songCount, a.duration) === "Album");
  const singles = albums.filter((a) => releaseKind(a.songCount, a.duration) !== "Album");
  const artistSongs = useMemo(() => (librarySongs.data ?? []).filter((song) => song.artistId === id || song.artists?.some((songArtist) => songArtist.id === id)), [librarySongs.data, id]);
  const visibleSongs = useMemo(() => shownSongs(artistSongs, songOrder, songFilter), [artistSongs, songOrder, songFilter]);
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

  const sectionHref = (artistSection: string | null) => {
    const sectionParams = new URLSearchParams(searchParams);

    if (artistSection) sectionParams.set("section", artistSection);
    else sectionParams.delete("section");

    return `?${sectionParams.toString()}`;
  };

  if (isLoading) return <PageSkeleton />;
  if (isError || !artist || !albums.length) return <NotFoundState what="artist" error={error} retry={() => void refetch()} name={artist?.name} />;

  const songCount = albums.reduce((n, a) => n + a.songCount, 0);
  const plays = albums.reduce((n, a) => n + (a.playCount ?? 0), 0);
  const bio = plainBio(info?.biography);
  const context = { kind: "artist" as const, id: artist.id, name: artist.name };
  const songsSection = (
    <section>
      <RowHeader
        title="Songs"
        action={
          <div className="collection-actions">
            <SearchField variant="inline" collapsible value={songFilter} onChange={setSongFilter} label="Find in artist songs" />
            <CollectionTools sorts={ARTIST_SONG_SORTS} order={songOrder} onOrder={setSongOrder} />
            {!section && artistSongs.length > SONG_PREVIEW ? <Link className="show-all" to={sectionHref("songs")}>Show all</Link> : null}
          </div>
        }
      />
      {librarySongs.isLoading ? <p className="muted" role="status">Loading songs…</p> : librarySongs.isError ? (
        <div className="empty-inline">
          <p className="muted">Couldn’t load this artist’s songs.</p>
          <button type="button" className="btn ghost sm" onClick={() => void librarySongs.refetch()}>Try again</button>
        </div>
      ) : (
        <TrackList
          songs={visibleSongs}
          context={context}
          art
          album={section === "songs"}
          header={section === "songs"}
          {...(!section ? { limit: SONG_PREVIEW } : {})}
          column={songOrder.key === "year" ? { label: "Release date", value: releaseDateLabel, sort: "year" } : { label: "Plays", value: (song) => song.playCount ? count(song.playCount) : "", sort: "plays" }}
          order={songOrder}
          onOrder={setSongOrder}
          fallback={MOST_PLAYED}
        />
      )}
    </section>
  );

  return (
    <div className={section === "songs" ? "artist-page artist-songs-page" : "artist-page"}>
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="a-hero">
        <div className="bg">
          <Art id={banner ?? albums[0]?.coverArt} px={900} sizes="100vw" eager fallback="artist" className={banner ? "" : "blurred"} />
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
        <PlayContextButton contextId={artist.id} label={artist.name} disabled={!artistSongs.length} onPlay={() => player.playSongs(shownSongs(artistSongs, songOrder, ""), 0, context)} />
        <ShuffleButton label={artist.name} disabled={!artistSongs.length} onShuffle={() => player.playSongs(shownSongs(artistSongs, songOrder, ""), 0, context, { shuffle: true })} />
        <button type="button" className="btn ghost sm" onClick={() => void player.startRadio({ artistId: artist.id, name: artist.name })}>
          <Icon name="radio" size={15} />Artist radio
        </button>
        <LikeButton kind="artist" item={artist} />
      </ActBar>
      {!section ? (
        <div className={bio ? "a-grid with-about" : "a-grid"}>
          {songsSection}
          {bio ? <About name={artist.name} bio={bio} /> : null}
        </div>
      ) : null}
      <div className="pad">
        {section ? <Link className="show-all artist-back" to={sectionHref(null)}><Icon name="back" size={16} />Back to artist</Link> : null}
        {section === "songs" ? songsSection : null}
        {(!section || section === "albums") && fullAlbums.length ? <Collection id="artist-albums" title="Albums" items={fullAlbums.map((album) => albumItem(album, [album.year, "Album"].filter(Boolean).join(", ")))} sorts={ARTIST_RELEASE_SORTS} {...(!section ? { preview: 6, to: sectionHref("albums") } : {})} /> : null}
        {(!section || section === "singles") && singles.length ? <Collection id="artist-singles" title="Singles and EPs" items={singles.map((album) => albumItem(album, [album.year, releaseKind(album.songCount, album.duration)].filter(Boolean).join(", ")))} sorts={ARTIST_RELEASE_SORTS} {...(!section ? { preview: 6, to: sectionHref("singles") } : {})} /> : null}
        {!section && inLibrary.length ? (
          <>
            <RowHeader title="Similar artists in your library" />
            <CardRow>{inLibrary.map((a) => <ArtistCard key={a.id} artist={a} />)}</CardRow>
          </>
        ) : null}
        {!section && lidarrOn && missing.data?.length ? (
          <>
            <RowHeader title="Similar artists you don’t have" subtitle="Picked from Last.fm. Open one to find their albums and songs." />
            <div className="get">{missing.data.map((a) => <ArtistSearchCard key={a.foreignArtistId} artist={a} />)}</div>
          </>
        ) : null}
      </div>
    </div>
  );
}
