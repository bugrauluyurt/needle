import type { DiscoveryDetail, DiscoveryPlaylist } from "@needle/shared";
import { player } from "../player/controller.ts";
import type { PlayContext } from "../player/store.ts";
import { queryClient } from "../queries/client.ts";
import { discoveryOptions } from "../queries/hooks.ts";
import { toast } from "../state/ui.ts";
import { Collage } from "./Art.tsx";
import { Card } from "./Cards.tsx";

export const discoveryContext = (p: Pick<DiscoveryPlaylist, "id" | "name">): PlayContext => ({
  kind: "playlist",
  id: `lb:${p.id}`,
  name: p.name,
});

export const librarySongs = (d: DiscoveryDetail) => d.tracks.flatMap((t) => (t.song ? [t.song] : []));

export function discoverySummary(p: Pick<DiscoveryPlaylist, "total" | "inLibrary">): string {
  const toGet = p.total - p.inLibrary;
  if (!toGet) return `All ${p.total} in your library`;
  if (!p.inLibrary) return `${toGet} to get`;
  return `${p.inLibrary} in your library, ${toGet} to get`;
}

export async function playDiscovery(p: Pick<DiscoveryPlaylist, "id" | "name">, shuffle = false) {
  const detail = await queryClient.fetchQuery(discoveryOptions(p.id)).catch(() => null);
  if (!detail) {
    toast("ListenBrainz didn’t send this playlist. Try again in a moment.");
    return;
  }
  player.playSongs(librarySongs(detail), 0, discoveryContext(p), { shuffle });
}

export function DiscoveryArt({
  playlist,
  px,
  eager = false,
}: {
  playlist: Pick<DiscoveryPlaylist, "covers" | "coverArts">;
  px: number;
  eager?: boolean;
}) {
  return <Collage urls={playlist.covers} ids={playlist.coverArts} px={px} eager={eager} />;
}

export function DiscoveryCard({ playlist }: { playlist: DiscoveryPlaylist }) {
  return (
    <Card
      to={`/listenbrainz/${playlist.id}`}
      art={<DiscoveryArt playlist={playlist} px={180} />}
      title={playlist.name}
      subtitle={discoverySummary(playlist)}
      playingId={discoveryContext(playlist).id ?? ""}
      {...(playlist.inLibrary ? { onPlay: () => void playDiscovery(playlist) } : {})}
    />
  );
}
