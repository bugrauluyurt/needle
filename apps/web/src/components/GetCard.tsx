import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LidarrAlbum } from "@needle/shared";
import { api } from "../lib/api.ts";
import { toast } from "../state/ui.ts";
import { Icon } from "./Icon.tsx";

export function GetCard({ album }: { album: LidarrAlbum }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const get = async () => {
    setBusy(true);
    try {
      const updated = await api.lidarrGet(album.foreignAlbumId);
      qc.setQueriesData<LidarrAlbum[]>({ queryKey: ["lidarrSearch"] }, (old) => old?.map((a) => (a.foreignAlbumId === album.foreignAlbumId ? { ...a, ...updated, state: updated.state === "missing" || updated.state === "wanted" ? "searching" : updated.state } : a)));
      toast(`Lidarr is looking for ${album.title}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Lidarr didn’t take the request");
    } finally {
      setBusy(false);
    }
  };
  const state = album.state;
  return (
    <div className="get-card">
      <div className="art get-art">{album.coverUrl ? <img src={album.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="art-fallback"><Icon name="album" size={28} /></span>}</div>
      <div className="get-text">
        <div className="t">{album.title}</div>
        <div className="s">{[album.artist, album.year, album.trackCount ? `${album.trackCount} songs` : null].filter(Boolean).join(", ")}</div>
        {state === "missing" || state === "wanted" ? (
          <button type="button" className="btn light sm" disabled={busy} onClick={() => void get()}>
            <Icon name="download" size={15} />{busy ? "Asking Lidarr…" : "Get album"}
          </button>
        ) : state === "searching" ? (
          <div className="get-state"><span className="spin" />Searching indexers</div>
        ) : state === "downloading" ? (
          <div className="get-state"><div className="line static" style={{ "--p": `${Math.round((album.progress ?? 0) * 100)}%` } as React.CSSProperties}><i /></div>Downloading, {Math.round((album.progress ?? 0) * 100)}%</div>
        ) : state === "importing" ? (
          <div className="get-state"><span className="spin" />Adding to your library</div>
        ) : (
          <div className="get-state ok">In your library</div>
        )}
      </div>
    </div>
  );
}
