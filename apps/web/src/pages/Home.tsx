import { Link, useNavigate } from "react-router";
import type { Album, Mix } from "@needle/shared";
import { Art, LikedArt } from "../components/Art.tsx";
import { AlbumCard, ArtistCard, Card, CardRow, CardSkeletons, playAlbum, RowHeader } from "../components/Cards.tsx";
import { EmptyLibrary } from "../components/EmptyLibrary.tsx";
import { Eq, Icon } from "../components/Icon.tsx";
import { clock, greeting, hoursSince } from "../lib/format.ts";
import { useDelayed } from "../lib/useDelayed.ts";
import { useTone } from "../lib/tone.ts";
import { MixArt, playMix } from "../components/MixArt.tsx";
import { player } from "../player/controller.ts";
import { usePlayer } from "../player/store.ts";
import { useAlbumList, useArtists, useMixes, useStarred, useStats } from "../queries/hooks.ts";
import { usePageTone, useIsMobile } from "../layout/Shell.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { MobileHeader } from "../layout/Mobile.tsx";
import { image, spId } from "../lib/spotify.ts";
import { useSpotifyAlbums, useSpotifyLiked, useSpotifyOn, useSpotifyPlaylists } from "../queries/spotify.ts";
import { playSpotifyPlaylist, SpotifyAlbumCard, SpotifyPlaylistCard } from "../components/SpotifyCards.tsx";

const YEAR_MS = 365 * 86_400_000;

function QuickTile({ to, art, title, playingId, onPlay }: { to: string; art: React.ReactNode; title: string; playingId?: string; onPlay?: () => void }) {
  const ctxId = usePlayer((s) => s.context?.id);
  const playing = usePlayer((s) => s.playing);
  const isCurrent = Boolean(playingId && ctxId === playingId);
  return (
    <div className="q">
      <Link to={to} className="q-link">
        {art}
        <span>{title}</span>
      </Link>
      {isCurrent ? <Eq paused={!playing} /> : null}
      {onPlay ? (
        <button type="button" className="q-play" aria-label={`Play ${title}`} onClick={onPlay}>
          <Icon name="play" size={16} />
        </button>
      ) : null}
    </div>
  );
}

function Resume() {
  const offer = usePlayer((s) => s.resume);
  const song = offer?.songs[offer.index];
  const tone = useTone(song?.coverArt);
  if (!offer || !song) return null;
  const pct = song.duration ? Math.min(100, (offer.position / song.duration) * 100) : 0;
  const hours = hoursSince(offer.changed);
  const when = hours < 1 ? "a few minutes ago" : hours === 1 ? "an hour ago" : hours < 24 ? `${hours} hours ago` : "recently";
  return (
    <section className="resume" style={{ "--tone": tone } as React.CSSProperties} aria-label="Pick up where you left off">
      <Art id={song.coverArt} px={112} />
      <div className="resume-text">
        <div className="k"><Icon name="devices" size={15} />Stopped on {offer.changedBy}, {when}</div>
        <div className="h">Pick up {song.album ?? song.title} where you left it</div>
        <div className="prog">
          <span className="ellipsis">Track {offer.index + 1}, {song.title}</span>
          <div className="line static" style={{ "--p": `${pct}%` } as React.CSSProperties}><i /></div>
          <span className="tabular">{clock(offer.position)} of {clock(song.duration)}</span>
        </div>
      </div>
      <div className="actions">
        <button type="button" className="btn primary" onClick={player.acceptResume}>
          <Icon name="play" size={16} />Resume here
        </button>
        <button type="button" className="icon-btn" aria-label="Dismiss" onClick={player.dismissResume}>
          <Icon name="close" size={18} />
        </button>
      </div>
    </section>
  );
}

function SpotifyLikedTile() {
  const { data: liked = [] } = useSpotifyLiked();
  const context = { kind: "liked" as const, id: "sp:liked", name: "Liked on Spotify" };
  return <QuickTile to="/spotify/liked" art={<LikedArt className="sp-liked" />} title="Liked on Spotify" playingId="sp:liked" {...(liked.length ? { onPlay: () => player.playSongs(liked, 0, context) } : {})} />;
}

function SpotifyRows() {
  const playlists = useSpotifyPlaylists();
  const albums = useSpotifyAlbums();
  const mine = (playlists.data ?? []).toSorted((a, b) => Number(b.mine) - Number(a.mine));
  return (
    <>
      {playlists.isPending || mine.length ? (
        <>
          <RowHeader title="Your Spotify playlists" to="/library" />
          <CardRow>{playlists.isPending ? <CardSkeletons /> : mine.map((p) => <SpotifyPlaylistCard key={p.id} playlist={p} />)}</CardRow>
        </>
      ) : null}
      {albums.isPending || albums.data?.length ? (
        <>
          <RowHeader title="Albums you saved on Spotify" to="/library" />
          <CardRow>{albums.data ? albums.data.map((a) => <SpotifyAlbumCard key={a.id} album={a} />) : <CardSkeletons />}</CardRow>
        </>
      ) : null}
    </>
  );
}

function SpotifyHome({ header }: { header: React.ReactNode }) {
  const mobile = useIsMobile();
  const { data: playlists = [] } = useSpotifyPlaylists();
  return (
    <div className="tinted">
      {header}
      <div className="pad">
        {!mobile ? <h1 className="hello">{greeting()}</h1> : null}
        <div className="quick">
          <SpotifyLikedTile />
          {playlists.slice(0, mobile ? 5 : 7).map((p) => (
            <QuickTile key={p.id} to={`/spotify/playlist/${p.id}`} art={<Art id={image(p.images, 64)} px={56} />} title={p.name} playingId={spId(p.id)} onPlay={() => void playSpotifyPlaylist(p.id)} />
          ))}
        </div>
        <Resume />
        <SpotifyRows />
        <EmptyLibrary compact />
      </div>
    </div>
  );
}

function MixCard({ mix }: { mix: Mix }) {
  return <Card to={`/mix/${mix.id}`} art={<MixArt mix={mix} />} title={mix.name} subtitle={mix.description} onPlay={() => playMix(mix)} />;
}

function HomeSkeleton() {
  const show = useDelayed(true);
  if (!show) return null;
  return (
    <div className="pad" aria-busy="true" aria-label="Loading">
      <div className="quick">{Array.from({ length: 8 }, (_, i) => <div key={i} className="q skeleton" />)}</div>
      <div className="skeleton line-skel" style={{ width: 240, height: 22, marginTop: 34 }} />
      <CardRow><CardSkeletons /></CardRow>
    </div>
  );
}

function forgotten(albums: Album[] | undefined): Album[] {
  const cutoff = Date.now() - YEAR_MS / 2;
  return (albums ?? []).filter((a) => a.played && Date.parse(a.played) < cutoff).slice(0, 12);
}

export default function Home() {
  const mobile = useIsMobile();
  const navigate = useNavigate();
  const recent = useAlbumList("recent", 12);
  const newest = useAlbumList("newest", 12);
  const frequent = useAlbumList("frequent", 60);
  const random = useAlbumList("random", 12);
  const mixes = useMixes();
  const stats = useStats("month");
  const starred = useStarred();
  const { data: allArtists } = useArtists();
  const artistCover = (id: string) => allArtists?.find((x) => x.id === id)?.coverArt;
  const current = usePlayer((s) => s.items[s.index]?.song);
  const headerCover = current?.coverArt ?? recent.data?.[0]?.coverArt ?? newest.data?.[0]?.coverArt;
  const tone = useTone(headerCover);
  const spotifyOn = useSpotifyOn();
  usePageTone(tone);
  const header = mobile ? <MobileHeader title={greeting()} /> : <TopBar />;

  if (newest.isPending || recent.isPending || mixes.isPending) {
    return (
      <>
        {header}
        <HomeSkeleton />
      </>
    );
  }

  if (!newest.data?.length) {
    return spotifyOn ? <SpotifyHome header={header} /> : (
      <>
        {header}
        <EmptyLibrary />
      </>
    );
  }

  const quick = [...(recent.data ?? []), ...(newest.data ?? [])].filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i).slice(0, (mobile ? 5 : 7) - (spotifyOn ? 1 : 0));
  const old = forgotten(frequent.data);
  const liked = starred.data?.song ?? [];

  return (
    <div className="tinted">
      {header}
      <div className="pad">
        {!mobile ? <h1 className="hello">{greeting()}</h1> : null}
        <div className="quick">
          <QuickTile to="/liked" art={<LikedArt />} title="Liked songs" playingId="liked" {...(liked.length ? { onPlay: () => player.playSongs(liked, 0, { kind: "liked", id: "liked", name: "Liked songs" }) } : {})} />
          {spotifyOn ? <SpotifyLikedTile /> : null}
          {quick.map((a) => (
            <QuickTile key={a.id} to={`/album/${a.id}`} art={<Art id={a.coverArt} px={56} />} title={a.name} playingId={a.id} onPlay={() => void playAlbum(a.id, a.name)} />
          ))}
        </div>
        <Resume />
        {mixes.data?.length ? (
          <>
            <RowHeader title="Mixes from your library" subtitle="Made from what you play most, refreshed every morning" />
            <CardRow>{mixes.data.map((m) => <MixCard key={m.id} mix={m} />)}</CardRow>
          </>
        ) : null}
        <RowHeader title="Recently added" to="/albums/newest" />
        <CardRow>{newest.data.map((a) => <AlbumCard key={a.id} album={a} />)}</CardRow>
        {spotifyOn ? <SpotifyRows /> : null}
        {old.length ? (
          <>
            <RowHeader title="You haven’t played these in a while" subtitle="Albums you played a lot, and not for six months" />
            <CardRow>{old.map((a) => <AlbumCard key={a.id} album={a} />)}</CardRow>
          </>
        ) : null}
        {stats.data?.topArtists.length ? (
          <>
            <RowHeader title="Your top artists this month" action={<button type="button" className="show-all" onClick={() => void navigate("/stats")}>See your listening</button>} />
            <CardRow>
              {stats.data.topArtists.map((a) => (
                <ArtistCard key={a.id} artist={{ id: a.id, name: a.name, ...(artistCover(a.id) ? { coverArt: artistCover(a.id) } : {}) }} subtitle={`${a.plays} ${a.plays === 1 ? "play" : "plays"}`} />
              ))}
            </CardRow>
          </>
        ) : null}
        {frequent.data?.length ? (
          <>
            <RowHeader title="Most played" to="/albums/frequent" />
            <CardRow>{frequent.data.slice(0, 12).map((a) => <AlbumCard key={a.id} album={a} />)}</CardRow>
          </>
        ) : null}
        <RowHeader title="Something different" subtitle="Picked at random from your library" to="/albums/random" />
        <CardRow>{random.data ? random.data.map((a) => <AlbumCard key={a.id} album={a} />) : <CardSkeletons />}</CardRow>
      </div>
    </div>
  );
}

