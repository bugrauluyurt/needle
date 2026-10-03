import type { LidarrAlbum, SongCandidate } from "@needle/shared";
import { fold, HOUR_MS, OTHER_VERSIONS, queryTerms } from "@needle/shared";
import { USER_AGENT } from "./version.ts";

const MIN_GAP_MS = 1100;
const CACHE_MS = HOUR_MS;
const LIMIT = 25;
const FEW = 3;
const BROWSE_LIMIT = 100;

type ReleaseGroup = {
  id: string;
  title: string;
  "first-release-date"?: string;
  "primary-type"?: string;
  "secondary-types"?: string[];
};
type Credit = { name: string; joinphrase?: string };
type Release = {
  title: string;
  date?: string;
  status?: string;
  "release-group"?: { id: string; "primary-type"?: string };
};
type Recording = {
  id: string;
  title: string;
  disambiguation?: string;
  length?: number;
  "first-release-date"?: string;
  "artist-credit"?: Credit[];
  releases?: Release[];
};

export class MusicBrainzError extends Error {}

const FILTER =
  "AND status:official AND (primarytype:album OR primarytype:single OR primarytype:ep) AND -secondarytype:(live OR compilation OR demo OR remix OR dj-mix OR mixtape) AND -comment:live";
const lucene = (q: string) => q.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, " ").trim();

const words = (text: string) =>
  fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
const creditOf = (r: Recording) =>
  (r["artist-credit"] ?? [])
    .map((c) => c.name + (c.joinphrase ?? ""))
    .join("")
    .trim();

export function toCandidates(recordings: Recording[], query = ""): SongCandidate[] {
  const terms = queryTerms(query);
  const other = OTHER_VERSIONS.filter((w) => !terms.includes(w));
  const ranked = recordings
    .map((r, order) => {
      const artist = creditOf(r);
      const named = words(`${artist} ${r.title}`);
      const hay = fold(`${artist} ${r.title}`);
      return {
        r,
        artist,
        order,
        covered: terms.filter((t) => hay.includes(t)).length,
        extra: named.filter((w) => !terms.includes(w)).length,
        odd: [...named, ...words(r.disambiguation ?? "")].some((w) => other.includes(w)),
      };
    })
    .filter((x) => x.artist && !x.odd)
    .sort(
      (a, b) =>
        b.covered - a.covered ||
        a.extra - b.extra ||
        Number(Boolean(a.r.disambiguation)) - Number(Boolean(b.r.disambiguation)) ||
        a.order - b.order,
    );
  const seen = new Set<string>();
  const out: SongCandidate[] = [];
  for (const { r, artist } of ranked) {
    const key = `${fold(artist)}|${fold(r.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const release =
      r.releases?.find((x) => x.status === "Official" && x["release-group"]?.["primary-type"] === "Album") ??
      r.releases?.[0];
    const year = Number.parseInt(release?.date ?? r["first-release-date"] ?? "", 10);
    const group = release?.["release-group"]?.id;
    out.push({
      id: r.id,
      title: r.title,
      artist,
      album: release?.title ?? null,
      duration: r.length ? Math.round(r.length / 1000) : null,
      year: Number.isNaN(year) ? null : year,
      coverUrl: group ? `https://coverartarchive.org/release-group/${group}/front-250` : null,
    });
  }
  return out;
}

export class MusicBrainz {
  private readonly url: string;
  private next = 0;
  private readonly cache = new Map<string, { at: number; songs: SongCandidate[] }>();

  constructor(url: string) {
    this.url = url;
  }

  async recordings(query: string): Promise<SongCandidate[]> {
    const key = fold(query);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.songs;
    const q = lucene(query);
    const both = await this.search(`recording:(${q}) AND artist:(${q}) ${FILTER}`);
    const titles = both.length < FEW ? await this.search(`recording:(${q}) ${FILTER}`) : [];
    const songs = toCandidates([...both, ...titles], query);
    this.cache.set(key, { at: Date.now(), songs });
    return songs;
  }

  async albumsBy(artistId: string, artist: string): Promise<LidarrAlbum[]> {
    const { "release-groups": groups = [] } = await this.get<{ "release-groups"?: ReleaseGroup[] }>("release-group", {
      artist: artistId,
      type: "album",
      limit: String(BROWSE_LIMIT),
    });
    return groups
      .filter((g) => g["primary-type"] === "Album" && !g["secondary-types"]?.length)
      .sort((a, b) => (b["first-release-date"] ?? "").localeCompare(a["first-release-date"] ?? ""))
      .map((g) => {
        const year = Number.parseInt(g["first-release-date"] ?? "", 10);
        return {
          foreignAlbumId: g.id,
          title: g.title,
          artist,
          foreignArtistId: artistId,
          year: Number.isNaN(year) ? null : year,
          trackCount: null,
          coverUrl: `https://coverartarchive.org/release-group/${g.id}/front-250`,
          state: "missing",
          progress: null,
        };
      });
  }

  async ping(): Promise<void> {
    await this.get("recording", { query: "needle", limit: "1" });
  }

  private async search(query: string): Promise<Recording[]> {
    return (
      (await this.get<{ recordings?: Recording[] }>("recording", { query, limit: String(LIMIT) })).recordings ?? []
    );
  }

  private async get<T>(path: string, params: Record<string, string>, retry = true): Promise<T> {
    const wait = this.next - Date.now();
    this.next = Math.max(Date.now(), this.next) + MIN_GAP_MS;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const url = `${this.url}/${path}?${new URLSearchParams({ ...params, fmt: "json" }).toString()}`;
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {
      throw new MusicBrainzError("MusicBrainz isn't responding");
    });
    if (res.status === 503 && retry) return this.get(path, params, false);
    if (!res.ok) throw new MusicBrainzError(`MusicBrainz answered ${res.status}`);
    return (await res.json()) as T;
  }
}
