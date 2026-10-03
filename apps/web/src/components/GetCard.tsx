import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type {
  LidarrAlbum,
  LidarrArtist,
  RequestItem,
  SongCandidate,
} from "@needle/shared";
import { api } from "../lib/api.ts";
import { toast } from "../state/ui.ts";
import { keys } from "../queries/keys.ts";
import { clock, plural } from "../lib/format.ts";
import { useGetSong } from "../queries/hooks.ts";
import { RecordArt } from "./Art.tsx";
import { Icon } from "./Icon.tsx";
import { RequestState } from "./RequestState.tsx";
import { translate } from "../i18n/index.ts";

export function RemoteCover({
  url,
  round = false,
  record,
}: {
  url: string | null;
  round?: boolean;
  record?: string | undefined;
}) {
  const [broken, setBroken] = useState(false);
  const fallback =
    record === undefined ? (
      <Icon name={round ? "user" : "album"} size={28} />
    ) : (
      <RecordArt seed={record} />
    );
  return (
    <div className={round ? "art round get-art" : "art get-art"}>
      {url && !broken ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="art-fallback">{fallback}</span>
      )}
    </div>
  );
}

export function ArtistSearchCard({ artist }: { artist: LidarrArtist }) {
  return (
    <Link
      to={`/search?q=${encodeURIComponent(artist.name)}`}
      className="get-card"
    >
      <RemoteCover url={artist.imageUrl} round />
      <div className="get-text">
        <div className="t">{artist.name}</div>
        <div className="s">
          {artist.disambiguation ?? translate("spotify.artist")}
        </div>
        <div className="get-state">{translate("get.artistHint")}</div>
      </div>
    </Link>
  );
}

export function GetSongCard({
  song,
  request,
  canGet = true,
}: {
  song: SongCandidate;
  request?: RequestItem | undefined;
  canGet?: boolean;
}) {
  const getSong = useGetSong();
  const [busy, setBusy] = useState(false);
  const idle = !request || request.state === "failed";
  return (
    <div className="get-card">
      <RemoteCover url={song.coverUrl} />
      <div className="get-text">
        <div className="t">{song.title}</div>
        <div className="s">
          {[
            song.artist,
            song.album,
            song.duration ? clock(song.duration) : null,
          ]
            .filter(Boolean)
            .join(", ")}
        </div>
        {idle ? (
          <>
            {request ? (
              <RequestState
                kind="song"
                state={request.state}
                progress={request.progress}
                detail={request.detail}
              />
            ) : null}
            {canGet ? (
              <button
                type="button"
                className="btn light sm"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void getSong(song).finally(() => setBusy(false));
                }}
              >
                <Icon name="download" size={15} />
                {translate(
                  busy ? "get.starting" : request ? "common.retry" : "get.song",
                )}
              </button>
            ) : null}
          </>
        ) : (
          <RequestState
            kind="song"
            state={request.state}
            progress={request.progress}
            detail={request.detail}
          />
        )}
      </div>
    </div>
  );
}

export function GetCard({
  album,
  request,
}: {
  album: LidarrAlbum;
  request?: RequestItem | undefined;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const get = async () => {
    setBusy(true);
    try {
      await api.lidarrGet(album.foreignAlbumId);
      await qc.refetchQueries({ queryKey: keys.requests });
      toast(translate("menu.lidarrLooking", { title: album.title }));
    } catch (e) {
      toast(e instanceof Error ? e.message : translate("menu.lidarrFailed"));
    } finally {
      setBusy(false);
    }
  };
  const state = request?.state ?? album.state;
  const progress = request ? request.progress : album.progress;
  return (
    <div className="get-card">
      <RemoteCover url={album.coverUrl} record={album.foreignAlbumId} />
      <div className="get-text">
        <div className="t">{album.title}</div>
        <div className="s">
          {[
            album.artist,
            album.year,
            album.trackCount ? plural(album.trackCount, "song") : null,
          ]
            .filter(Boolean)
            .join(", ")}
        </div>
        {state === "missing" || (state === "wanted" && !request) ? (
          <button
            type="button"
            className="btn light sm"
            disabled={busy}
            onClick={() => void get()}
          >
            <Icon name="download" size={15} />
            {translate(busy ? "get.askingLidarr" : "get.album")}
          </button>
        ) : (
          <RequestState state={state} progress={progress} />
        )}
      </div>
    </div>
  );
}
