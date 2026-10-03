import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { trackCandidate } from "@needle/shared";
import type { DiscoveryDetail, DiscoveryTrack } from "@needle/shared";
import { discoveryContext, DiscoveryArt, librarySongs } from "../components/Discovery.tsx";
import { GetSongCard } from "../components/GetCard.tsx";
import { ActBar, Hero, NotFoundState, PageSkeleton, PlayContextButton, ShuffleButton } from "../components/Hero.tsx";
import { Icon } from "../components/Icon.tsx";
import { TrackList } from "../components/tracks/TrackList.tsx";
import { api, ApiError } from "../lib/api.ts";
import { plain, plural } from "../lib/format.ts";
import { useTone } from "../lib/tone.ts";
import { MobileBack } from "../layout/Mobile.tsx";
import { useIsMobile } from "../lib/media.ts";
import { usePageTone } from "../layout/pageTone.ts";
import { TopBar } from "../layout/TopBar.tsx";
import { player } from "../player/controller.ts";
import { keys } from "../queries/keys.ts";
import { useCapabilities, useDiscovery } from "../queries/hooks.ts";
import { toast } from "../state/ui.ts";
import { translate } from "../i18n/index.ts";

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
  const getMissing = () =>
    run(
      "get",
      async () => {
        const r = await api.discoveryMissing(playlist.id);
        await Promise.all([
          qc.invalidateQueries({ queryKey: keys.discovery(playlist.id) }),
          qc.invalidateQueries({ queryKey: keys.requests }),
        ]);
        toast(
          translate("discovery.lookingSoulseek", {
            songs: plural(r.started, "song"),
            details: r.skipped ? translate("discovery.skippedDetail", { count: r.skipped }) : "",
          }),
          {
            label: translate("common.requests"),
            run: () => void navigate("/requests"),
          },
        );
      },
      translate("discovery.downloadFailed"),
    );
  const save = () =>
    run(
      "save",
      async () => {
        const r = await api.discoverySave(playlist.id);
        await qc.invalidateQueries({ queryKey: keys.playlists });
        toast(
          translate("discovery.savedPlaylist", {
            songs: plural(r.matched, "song"),
          }),
          {
            label: translate("common.open"),
            run: () => void navigate(`/playlist/${r.playlistId}`),
          },
        );
      },
      translate("discovery.saveFailed"),
    );
  return (
    <ActBar>
      {songs.length ? (
        <>
          <PlayContextButton
            contextId={context.id ?? ""}
            label={playlist.name}
            onPlay={() => player.playSongs(songs, 0, context)}
          />
          <ShuffleButton
            label={playlist.name}
            onShuffle={() => player.playSongs(songs, 0, context, { shuffle: true })}
          />
        </>
      ) : null}
      {canGet && missing ? (
        <button type="button" className="btn light sm" disabled={busy !== null} onClick={() => void getMissing()}>
          <Icon name="download" size={15} />
          {busy === "get" ? translate("discovery.starting") : translate("discovery.getMissing", { count: missing })}
        </button>
      ) : null}
      {songs.length ? (
        <button
          type="button"
          className="btn ghost sm"
          aria-label={translate("discovery.savePlaylist")}
          disabled={busy !== null}
          onClick={() => void save()}
        >
          <Icon name="plus" size={15} />
          <span className="act-label">
            {translate(busy === "save" ? "discovery.saving" : "discovery.savePlaylist")}
          </span>
        </button>
      ) : null}
      <a
        className="icon-btn big"
        href={`https://listenbrainz.org/playlist/${playlist.id}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={translate("discovery.openListenBrainz")}
      >
        <Icon name="link" size={22} />
      </a>
    </ActBar>
  );
}

function Missing({ tracks }: { tracks: DiscoveryTrack[] }) {
  const canGet = useCapabilities().data?.songs ?? false;
  if (!tracks.length) return null;
  return (
    <section className="res-source pad" aria-label={translate("discovery.notInLibrary")}>
      <div className="source-h">
        <h2>{translate("discovery.notInLibrary")}</h2>
        <p className="sub">{canGet ? translate("discovery.soulseekHint") : translate("discovery.adminNeeded")}</p>
      </div>
      <div className="get">
        {tracks.map((t) => (
          <GetSongCard key={t.mbid} song={trackCandidate(t)} request={t.request ?? undefined} canGet={canGet} />
        ))}
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
          <h1>{translate(connect ? "discovery.connect" : "discovery.loadFailed")}</h1>
          <p>
            {connect
              ? translate("discovery.connectHint")
              : error instanceof Error
                ? error.message
                : translate("discovery.loadFailed")}
          </p>
          <div className="acts">
            {connect ? (
              <Link to="/settings" className="btn primary">
                {translate("empty.goSettings")}
              </Link>
            ) : (
              <button type="button" className="btn primary" onClick={retry}>
                <Icon name="refresh" size={16} />
                {translate("common.retry")}
              </button>
            )}
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
  if (!data)
    return error instanceof ApiError && error.status === 404 ? (
      <NotFoundState what="playlist" />
    ) : (
      <LoadError error={error} retry={() => void refetch()} />
    );
  const songs = librarySongs(data);
  return (
    <div className="tinted">
      <Hero
        art={<DiscoveryArt playlist={data} px={232} eager />}
        kind={translate("discovery.madeForYou")}
        title={data.name}
        description={plain(data.description)}
        meta={
          <span>
            {translate("discovery.libraryTotal", {
              songs: plural(data.total, "song"),
              count: data.inLibrary,
            })}
          </span>
        }
      />
      <Actions playlist={data} />
      {songs.length ? <TrackList songs={songs} context={discoveryContext(data)} art album /> : null}
      <Missing tracks={data.tracks.filter((t) => !t.song)} />
    </div>
  );
}
