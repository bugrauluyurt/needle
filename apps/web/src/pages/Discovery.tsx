import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { trackCandidate } from "@needle/shared";
import type { DiscoveryDetail, DiscoveryTrack } from "@needle/shared";
import { discoveryContext, DiscoveryArt, librarySongs } from "../components/Discovery.tsx";
import { GetSongCard } from "../components/GetCard.tsx";
import { ActBar, Hero, NotFoundState, PageSkeleton, PlayContextButton, ShuffleButton } from "../components/Hero.tsx";
import { Icon } from "../components/Icon.tsx";
import { TrackList } from "../components/TrackList.tsx";
import { api, ApiError } from "../lib/api.ts";
import { plain, plural } from "../lib/format.ts";
import { useTone } from "../lib/tone.ts";
import { MobileBack } from "../layout/Mobile.tsx";
import { useIsMobile, usePageTone } from "../layout/Shell.tsx";
import { TopBar } from "../layout/TopBar.tsx";
import { player } from "../player/controller.ts";
import { keys } from "../queries/keys.ts";
import { useCapabilities, useDiscovery } from "../queries/hooks.ts";
import { toast } from "../state/ui.ts";

const wanted = (t: DiscoveryTrack) => !t.request || t.request.state === "failed";

function Actions({ playlist }: { playlist: DiscoveryDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canGet = useCapabilities().data?.songs ?? false;
  const [busy, setBusy] = useState<"get" | "save" | null>(null);
  const songs = librarySongs(playlist);
  const missing = playlist.tracks.filter((t) => !t.song && wanted(t)).length;
  const context = discoveryContext(playlist);
  const run = async (what: "get" | "save", job: () => Promise<void>, failed: string) => {
    setBusy(what);
    try {
      await job();
    } catch (e) {
      toast(e instanceof Error ? e.message : failed);
    } finally {
      setBusy(null);
    }
  };
  const getMissing = () => run("get", async () => {
    const r = await api.discoveryMissing(playlist.id);
    await Promise.all([qc.invalidateQueries({ queryKey: keys.discovery(playlist.id) }), qc.invalidateQueries({ queryKey: keys.requests })]);
    toast(`Looking for ${plural(r.started, "song")} on Soulseek${r.skipped ? `; ${r.skipped} more next time` : ""}`, { label: "Requests", run: () => void navigate("/requests") });
  }, "Couldn’t start the downloads");
  const save = () => run("save", async () => {
    const r = await api.discoverySave(playlist.id);
    await qc.invalidateQueries({ queryKey: keys.playlists });
    toast(`Saved ${plural(r.matched, "song")} as a playlist`, { label: "Open", run: () => void navigate(`/playlist/${r.playlistId}`) });
  }, "Couldn’t save the playlist");
  return (
    <ActBar>
      {songs.length ? (
        <>
          <PlayContextButton contextId={context.id ?? ""} label={playlist.name} onPlay={() => player.playSongs(songs, 0, context)} />
          <ShuffleButton label={playlist.name} onShuffle={() => player.playSongs(songs, 0, context, { shuffle: true })} />
        </>
      ) : null}
      {canGet && missing ? (
        <button type="button" className="btn light sm" disabled={busy !== null} onClick={() => void getMissing()}>
          <Icon name="download" size={15} />{busy === "get" ? "Starting…" : `Get ${missing} missing`}
        </button>
      ) : null}
      {songs.length ? (
        <button type="button" className="btn ghost sm" disabled={busy !== null} onClick={() => void save()}>
          <Icon name="plus" size={15} />{busy === "save" ? "Saving…" : "Save as playlist"}
        </button>
      ) : null}
      <a className="icon-btn big" href={`https://listenbrainz.org/playlist/${playlist.id}`} target="_blank" rel="noopener noreferrer" aria-label="Open on ListenBrainz">
        <Icon name="link" size={22} />
      </a>
    </ActBar>
  );
}

function Missing({ tracks }: { tracks: DiscoveryTrack[] }) {
  const canGet = useCapabilities().data?.songs ?? false;
  if (!tracks.length) return null;
  return (
    <section className="res-source pad" aria-label="Not in your library yet">
      <div className="source-h">
        <h2>Not in your library yet</h2>
        <p className="sub">{canGet ? "Soulseek provides the songs you pick. They show up in your library when they’re ready." : "Ask an admin to let you request songs."}</p>
      </div>
      <div className="get">
        {tracks.map((t) => <GetSongCard key={t.mbid} song={trackCandidate(t)} request={t.request ?? undefined} canGet={canGet} />)}
      </div>
    </section>
  );
}

function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
  const mobile = useIsMobile();
  const connect = error instanceof ApiError && error.status === 409;
  return (
    <>
      {mobile ? <MobileBack /> : <TopBar />}
      <div className="empty">
        <div className="empty-in">
          <h1>{connect ? "Connect ListenBrainz first" : "Couldn’t load this playlist"}</h1>
          <p>{connect ? "Add your ListenBrainz token in Settings to see the playlists it makes for you." : error instanceof Error ? error.message : "ListenBrainz didn’t answer."}</p>
          <div className="acts">
            {connect ? <Link to="/settings" className="btn primary">Go to Settings</Link> : <button type="button" className="btn primary" onClick={retry}><Icon name="refresh" size={16} />Try again</button>}
          </div>
        </div>
      </div>
    </>
  );
}

export default function DiscoveryPage() {
  const { id = "" } = useParams();
  const { data, isLoading, error, refetch } = useDiscovery(id);
  usePageTone(useTone(data?.covers[0]));
  if (isLoading) return <PageSkeleton />;
  if (!data) return error instanceof ApiError && error.status === 404 ? <NotFoundState what="playlist" /> : <LoadError error={error} retry={() => void refetch()} />;
  const songs = librarySongs(data);
  return (
    <div className="tinted">
      <Hero
        art={<DiscoveryArt playlist={data} px={232} eager />}
        kind="Made for you by ListenBrainz"
        title={data.name}
        description={plain(data.description)}
        meta={<span>{plural(data.total, "song")}, {data.inLibrary} in your library</span>}
      />
      <Actions playlist={data} />
      {songs.length ? <TrackList songs={songs} context={discoveryContext(data)} art album /> : null}
      <Missing tracks={data.tracks.filter((t) => !t.song)} />
    </div>
  );
}
