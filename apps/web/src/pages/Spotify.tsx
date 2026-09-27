import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type { Song } from "@needle/shared";
import { Art, LikedArt } from "../components/Art.tsx";
import { CardRow, CardSkeletons, RowHeader } from "../components/Cards.tsx";
import { ActBar, Hero, PageSkeleton, PlayContextButton, ShuffleButton } from "../components/Hero.tsx";
import { Icon } from "../components/Icon.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { api } from "../lib/api.ts";
import { ago, artistName, count, longDuration, plural, releaseKind } from "../lib/format.ts";
import { artistPath } from "../lib/paths.ts";
import { image, sp, spId, spotifyLink } from "../lib/spotify.ts";
import { playSpotifyArtist, SpotifyAlbumCard, SpotifyBadge } from "../components/SpotifyCards.tsx";
import { useTone } from "../lib/tone.ts";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { MobileBack } from "../layout/Mobile.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { player } from "../player/controller.ts";
import type { PlayContext } from "../player/store.ts";
import { useCapabilities } from "../queries/hooks.ts";
import { spKeys, useSpotifyAlbum, useSpotifyAlbums, useSpotifyArtist, useSpotifyLiked, useSpotifyOn, useSpotifyPlaylist, useSpotifyPlaylistEdits, useSpotifyPlaylists } from "../queries/spotify.ts";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "../state/ui.ts";

function plain(html: string | null | undefined): string | undefined {
  const text = html?.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "’").replace(/&quot;/g, "\"").trim();
  return text === "" ? undefined : text;
}
const duration = (songs: Song[]) => songs.reduce((n, s) => n + (s.duration ?? 0), 0);

function OpenInSpotify({ kind, id }: { kind: "album" | "artist" | "playlist"; id: string }) {
  return (
    <a className="icon-btn big" href={spotifyLink(kind, id)} target="_blank" rel="noopener noreferrer" aria-label="Open in Spotify">
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
            <Link to="/settings" className="btn primary">Go to Settings</Link>
          </div>
        </div>
      </div>
    </>
  );
}

function SpotifyError({ what, retry }: { what: string; retry: () => void }) {
  const mobile = useIsMobile();
  return (
    <>
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="empty">
        <div className="empty-in">
          <h1>Couldn’t load this {what} from Spotify</h1>
          <p>Spotify didn’t answer, or this {what} isn’t available to apps. Try again, or reconnect Spotify in Settings.</p>
          <div className="acts">
            <button type="button" className="btn primary" onClick={retry}><Icon name="refresh" size={16} />Try again</button>
          </div>
        </div>
      </div>
    </>
  );
}

export function SpotifyLikedPage() {
  const on = useSpotifyOn();
  const { data: songs, isLoading, isError, refetch } = useSpotifyLiked();
  const [filter, setFilter] = useState("");
  usePageTone("#1F5A3A");
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (songs ?? []).filter((s) => !q || `${s.title} ${artistName(s)} ${s.album ?? ""}`.toLowerCase().includes(q));
  }, [songs, filter]);
  if (!on) return <NotConnected />;
  if (isLoading) return <PageSkeleton />;
  if (isError || !songs) return <SpotifyError what="list" retry={() => void refetch()} />;
  const context: PlayContext = { kind: "liked", id: "sp:liked", name: "Liked on Spotify" };
  return (
    <div className="tinted">
      <Hero art={<LikedArt className="sp-liked" />} kind="Spotify" title="Liked on Spotify" meta={<span>{plural(songs.length, "song")}</span>} />
      <ActBar end={<label className="find"><Icon name="search" size={17} /><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find in liked songs" aria-label="Find in liked songs" /></label>}>
        <PlayContextButton contextId="sp:liked" label="Liked on Spotify" onPlay={() => player.playSongs(shown, 0, context)} />
        <ShuffleButton label="Liked on Spotify" onShuffle={() => player.playSongs(shown, 0, context, { shuffle: true })} />
      </ActBar>
      <TrackList songs={shown} context={context} art album column={{ label: "Date added", value: (s) => ago(s.starred) }} onPlay={(i) => player.playSongs(shown, i, context)} />
    </div>
  );
}

export function SpotifyPlaylistPage() {
  const { id = "" } = useParams();
  const on = useSpotifyOn();
  const { data, isLoading, isError, refetch } = useSpotifyPlaylist(id);
  const edits = useSpotifyPlaylistEdits();
  const { data: playlists } = useSpotifyPlaylists();
  const mine = playlists?.find((p) => p.id === id)?.mine;
  const tone = useTone(image(data?.meta.images, 64));
  usePageTone(tone);
  if (!on) return <NotConnected />;
  if (isLoading) return <PageSkeleton />;
  if (isError || !data) return <SpotifyError what="playlist" retry={() => void refetch()} />;
  const { meta, songs } = data;
  const context: PlayContext = { kind: "playlist", id: spId(id), name: meta.name };
  const total = meta.items?.total ?? meta.tracks?.total ?? songs?.length ?? 0;
  const editable = Boolean(mine) && songs !== null;
  return (
    <div className="tinted">
      <Hero
        art={<Art id={image(meta.images, 640)} px={232} eager />}
        kind={mine ? "Spotify playlist" : "Spotify playlist you follow"}
        title={meta.name}
        description={plain(meta.description)}
        meta={
          <>
            <b>{meta.owner.display_name ?? meta.owner.id}</b>
            <span>{plural(total, "song")}{songs?.length ? `, ${longDuration(duration(songs))}` : ""}</span>
          </>
        }
      />
      {songs ? (
        <ActBar>
          {songs.length ? (
            <>
              <PlayContextButton contextId={context.id ?? ""} label={meta.name} onPlay={() => player.playSongs(songs, 0, context)} />
              <ShuffleButton label={meta.name} onShuffle={() => player.playSongs(songs, 0, context, { shuffle: true })} />
            </>
          ) : null}
          <OpenInSpotify kind="playlist" id={id} />
        </ActBar>
      ) : null}
      {songs === null ? (
        <div className="pad sp-note">
          <h2>Spotify keeps this playlist’s songs to itself</h2>
          <p className="muted">Spotify only lets personal apps read playlists you made or collaborate on. Open it in Spotify, like the songs you want, and they’ll show up in Liked on Spotify here.</p>
          <a className="btn light" href={spotifyLink("playlist", id)} target="_blank" rel="noopener noreferrer"><Icon name="link" size={16} />Open in Spotify</a>
        </div>
      ) : songs.length ? (
        <TrackList
          songs={songs}
          context={context}
          art
          album
          column={{ label: "Added", value: (s) => ago(s.created) }}
          onPlay={(i) => player.playSongs(songs, i, context)}
          {...(editable ? {
            onReorder: (from: number, to: number) => void edits.reorder(id, from, to),
            menuExtra: (s: Song) => [{ label: "Remove from this playlist", icon: "trash" as const, run: () => void edits.remove(id, s) }],
          } : {})}
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
  const { data, isLoading, isError, refetch } = useSpotifyAlbum(id);
  const { data: saved } = useSpotifyAlbums();
  const caps = useCapabilities();
  const qc = useQueryClient();
  const tone = useTone(image(data?.album.images, 64));
  usePageTone(tone);
  const [busy, setBusy] = useState(false);
  if (!on) return <NotConnected />;
  if (isLoading) return <PageSkeleton />;
  if (isError || !data) return <SpotifyError what="album" retry={() => void refetch()} />;
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
      const [hit] = await api.lidarrSearch(`${album.artists?.[0]?.name ?? ""} ${album.name}`);
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
        art={<Art id={image(album.images, 640)} px={232} eager />}
        kind={`${album.album_type === "album" ? "Album" : album.album_type === "compilation" ? "Compilation" : releaseKind(songs.length, duration(songs))} on Spotify`}
        title={album.name}
        meta={
          <>
            {(album.artists ?? []).map((a) => <Link key={a.id} to={artistPath(spId(a.id))} className="meta-artist">{a.name}</Link>)}
            {year ? <span>{year}</span> : null}
            <span>{plural(songs.length, "song")}, {longDuration(duration(songs))}</span>
          </>
        }
      />
      <ActBar>
        <PlayContextButton contextId={context.id ?? ""} label={album.name} onPlay={() => player.playSongs(songs, 0, context)} />
        <ShuffleButton label={album.name} onShuffle={() => player.playSongs(songs, 0, context, { shuffle: true })} />
        <button type="button" className="icon-btn big" aria-pressed={isSaved} aria-label={isSaved ? "Remove from your Spotify library" : "Save to your Spotify library"} onClick={() => void toggleSave()}>
          <Icon name={isSaved ? "heartFill" : "heart"} size={28} />
        </button>
        {caps.data?.lidarr ? (
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void getAlbum()}>
            <Icon name="download" size={15} />{busy ? "Asking Lidarr…" : "Get album"}
          </button>
        ) : null}
        <OpenInSpotify kind="album" id={album.id} />
      </ActBar>
      <TrackList songs={songs} context={context} numbers="track" onPlay={(i) => player.playSongs(songs, i, context)} />
      <div className="pad">
        {album.label || album.copyrights?.[0] ? <p className="album-foot muted">{[year, album.label, album.copyrights?.[0]?.text].filter(Boolean).join(". ")}</p> : null}
      </div>
    </div>
  );
}

export function SpotifyArtistPage() {
  const { id = "" } = useParams();
  const on = useSpotifyOn();
  const mobile = useIsMobile();
  const { data, isLoading, isError, refetch } = useSpotifyArtist(id);
  const tone = useTone(image(data?.artist.images, 64));
  usePageTone(tone);
  if (!on) return <NotConnected />;
  if (isLoading) return <PageSkeleton />;
  if (isError || !data) return <SpotifyError what="artist" retry={() => void refetch()} />;
  const { artist, albums } = data;
  const full = albums.filter((a) => a.album_type === "album");
  const singles = albums.filter((a) => a.album_type !== "album");
  return (
    <div className="artist-page">
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="a-hero">
        <div className="bg"><Art id={image(artist.images, 640)} px={900} eager fallback="artist" /></div>
        <div className="a-hero-text">
          <div className="kind"><SpotifyBadge /> Artist</div>
          <h1 style={{ "--title": `${artist.name.length > 14 ? 76 : 112}px` } as React.CSSProperties}>{artist.name}</h1>
          <p>{artist.followers ? `${count(artist.followers.total)} followers on Spotify. ` : ""}{plural(albums.length, "release")}.</p>
        </div>
      </div>
      <ActBar>
        {full.length ? (
          <>
            <PlayContextButton contextId={spId(artist.id)} label={artist.name} onPlay={() => void playSpotifyArtist(artist.id)} />
            <ShuffleButton label={artist.name} onShuffle={() => void playSpotifyArtist(artist.id, true)} />
          </>
        ) : null}
        <OpenInSpotify kind="artist" id={artist.id} />
      </ActBar>
      <div className="pad">
        {full.length ? (
          <>
            <RowHeader title="Albums" />
            <CardRow grid={full.length > 6}>{full.map((a) => <SpotifyAlbumCard key={a.id} album={a} subtitle={a.release_date?.slice(0, 4) ?? ""} />)}</CardRow>
          </>
        ) : null}
        {singles.length ? (
          <>
            <RowHeader title="Singles and EPs" />
            <CardRow grid={singles.length > 6}>{singles.map((a) => <SpotifyAlbumCard key={a.id} album={a} subtitle={a.release_date?.slice(0, 4) ?? ""} />)}</CardRow>
          </>
        ) : null}
        {!albums.length ? <CardRow><CardSkeletons n={3} /></CardRow> : null}
      </div>
    </div>
  );
}
