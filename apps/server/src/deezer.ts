import type { SongCandidate } from "@needle/shared";
import { fold, HOUR_MS } from "@needle/shared";

const TOP = 10;

type DeezerArtist = { id: number; name: string };
type DeezerTrack = {
  id: number;
  title: string;
  duration: number;
  artist: { name: string };
  album: { title: string; cover_medium?: string };
};

export class Deezer {
  private readonly url: string;
  private readonly cache = new Map<string, { at: number; songs: SongCandidate[] }>();

  constructor(url: string) {
    this.url = url;
  }

  private async get<T>(path: string): Promise<T | null> {
    const res = await fetch(`${this.url}${path}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    return res?.ok ? ((await res.json()) as T) : null;
  }

  async ping(): Promise<boolean> {
    return (await this.get("/search/artist?q=needle&limit=1")) !== null;
  }

  async topSongs(artistName: string): Promise<SongCandidate[]> {
    const key = fold(artistName);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < HOUR_MS) return hit.songs;
    const found = await this.get<{ data?: DeezerArtist[] }>(
      `/search/artist?${new URLSearchParams({ q: artistName, limit: "5" }).toString()}`,
    );
    const artist = found?.data?.find((a) => fold(a.name) === key);
    const top = artist ? await this.get<{ data?: DeezerTrack[] }>(`/artist/${artist.id}/top?limit=${TOP}`) : null;
    const songs = (top?.data ?? []).map((t): SongCandidate => ({
      id: `deezer:${t.id}`,
      title: t.title,
      artist: t.artist.name,
      album: t.album.title,
      duration: t.duration,
      year: null,
      coverUrl: t.album.cover_medium ?? null,
    }));
    this.cache.set(key, { at: Date.now(), songs });
    return songs;
  }
}
