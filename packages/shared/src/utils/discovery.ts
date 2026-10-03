import type { DiscoveryTrack } from "../types/discovery.ts";
import type { SongCandidate } from "../types/requests.ts";

export function trackCandidate(discoveryTrack: DiscoveryTrack): SongCandidate {
  return {
    id: discoveryTrack.mbid,
    title: discoveryTrack.title,
    artist: discoveryTrack.artist,
    album: discoveryTrack.album,
    duration: discoveryTrack.duration,
    year: null,
    coverUrl: discoveryTrack.coverUrl,
  };
}
