import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { sub } from "../lib/subsonic.ts";
import { toast } from "../state/ui.ts";
import { Icon } from "./Icon.tsx";

export function EmptyLibrary({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [scanning, setScanning] = useState(false);
  const scan = async () => {
    setScanning(true);
    try {
      await sub.startScan();
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await sub.scanStatus();
        if (!s.scanning) {
          toast(s.count ? `Found ${s.count} songs` : "Still no songs in the music folder");
          await qc.invalidateQueries();
          break;
        }
      }
    } catch {
      toast("Couldn’t start a scan. Only Navidrome admins can.");
    } finally {
      setScanning(false);
    }
  };
  const text =
    "Navidrome hasn’t found any songs in your music folder. Search for an album to fetch it through Lidarr, or scan again if you’ve just added files.";
  const acts = (
    <div className="acts">
      <button type="button" className="btn primary" onClick={() => void navigate("/search")}>
        <Icon name="search" size={16} />
        Find music to add
      </button>
      <button type="button" className="btn ghost" disabled={scanning} onClick={() => void scan()}>
        {scanning ? <span className="spin" /> : <Icon name="refresh" size={16} />}
        {scanning ? "Scanning…" : "Scan the library again"}
      </button>
    </div>
  );
  if (compact) {
    return (
      <section className="empty-inline library-note">
        <h2>Your own library is empty</h2>
        <p className="muted">{text}</p>
        {acts}
      </section>
    );
  }
  return (
    <div className="empty">
      <div className="empty-in">
        <div className="stack" aria-hidden="true">
          <div className="slot s1" />
          <div className="slot s2">
            <Icon name="plus" size={30} />
          </div>
          <div className="slot s3" />
        </div>
        <h1>No music yet</h1>
        <p>{text}</p>
        {acts}
      </div>
    </div>
  );
}
