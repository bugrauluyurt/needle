import type { LidarrAlbum, LidarrArtist, LidarrState } from "@needle/shared";

type Image = { coverType: string; remoteUrl?: string; url?: string };
type Stats = { trackFileCount?: number; trackCount?: number; totalTrackCount?: number };
type RawArtist = {
  id?: number;
  artistName: string;
  foreignArtistId: string;
  images?: Image[];
  monitored?: boolean;
  qualityProfileId?: number;
  metadataProfileId?: number;
  rootFolderPath?: string;
};
type RawAlbum = {
  id?: number;
  title: string;
  foreignAlbumId: string;
  albumType?: string;
  monitored?: boolean;
  releaseDate?: string;
  images?: Image[];
  statistics?: Stats;
  artist?: RawArtist;
  artistId?: number;
  releases?: { trackCount?: number; monitored?: boolean }[];
  addOptions?: { searchForNewAlbum: boolean };
};
type QueueRecord = { albumId?: number; size?: number; sizeleft?: number; trackedDownloadState?: string };
type Command = { name: string; status: string; body?: { albumIds?: number[] } };
type Profile = { id: number; name: string };
type RootFolder = { path: string; defaultQualityProfileId?: number; defaultMetadataProfileId?: number };

const KEEP_TYPES = new Set(["Album", "EP"]);
const RESULTS = 6;

export class LidarrError extends Error {}

export class Lidarr {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly qualityProfile: string | null;
  private readonly rootFolder: string | null;

  constructor(opts: { url: string; apiKey: string; qualityProfile: string | null; rootFolder: string | null }) {
    this.url = opts.url;
    this.apiKey = opts.apiKey;
    this.qualityProfile = opts.qualityProfile;
    this.rootFolder = opts.rootFolder;
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.url}/api/v1${path}`, {
      ...init,
      headers: { "x-api-key": this.apiKey, "content-type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {
      throw new LidarrError("Lidarr isn't responding");
    });
    if (!res.ok) throw new LidarrError(`Lidarr ${init.method ?? "GET"} ${path.split("?")[0]} answered ${res.status}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  private cover(images: Image[] | undefined): string | null {
    const img = images?.find((i) => i.coverType === "cover") ?? images?.[0];
    return img?.remoteUrl ?? (img?.url?.startsWith("http") ? img.url : null);
  }

  private async activity(): Promise<{ queue: Map<number, QueueRecord>; searching: Set<number> }> {
    const [queue, commands] = await Promise.all([
      this.req<{ records: QueueRecord[] }>("/queue?pageSize=200&includeAlbum=false"),
      this.req<Command[]>("/command"),
    ]);
    const searching = new Set(commands
      .filter((c) => c.name === "AlbumSearch" && (c.status === "queued" || c.status === "started"))
      .flatMap((c) => c.body?.albumIds ?? []));
    return { queue: new Map(queue.records.filter((r) => r.albumId).map((r) => [r.albumId as number, r])), searching };
  }

  private state(album: RawAlbum, activity: { queue: Map<number, QueueRecord>; searching: Set<number> }): { state: LidarrState; progress: number | null } {
    if (!album.id) return { state: "missing", progress: null };
    const q = activity.queue.get(album.id);
    if (q) {
      const importing = q.trackedDownloadState?.startsWith("import") ?? false;
      const progress = q.size ? 1 - (q.sizeleft ?? 0) / q.size : null;
      return { state: importing ? "importing" : "downloading", progress };
    }
    if (activity.searching.has(album.id)) return { state: "searching", progress: null };
    const files = album.statistics?.trackFileCount ?? 0;
    if (files > 0) return { state: "available", progress: null };
    return { state: album.monitored ? "wanted" : "missing", progress: null };
  }

  private toAlbum(a: RawAlbum, activity: Awaited<ReturnType<Lidarr["activity"]>>): LidarrAlbum {
    const { state, progress } = this.state(a, activity);
    const trackCount = a.statistics?.totalTrackCount ?? a.releases?.find((r) => r.monitored)?.trackCount ?? a.releases?.[0]?.trackCount ?? null;
    return {
      foreignAlbumId: a.foreignAlbumId,
      title: a.title,
      artist: a.artist?.artistName ?? "",
      foreignArtistId: a.artist?.foreignArtistId ?? "",
      year: a.releaseDate ? new Date(a.releaseDate).getUTCFullYear() : null,
      trackCount,
      coverUrl: this.cover(a.images),
      state,
      progress,
    };
  }

  async searchAlbums(term: string): Promise<LidarrAlbum[]> {
    const results = await this.req<{ album?: RawAlbum }[]>(`/search?term=${encodeURIComponent(term)}`);
    const albums = results.map((r) => r.album).filter((a): a is RawAlbum => Boolean(a && (!a.albumType || KEEP_TYPES.has(a.albumType)))).slice(0, RESULTS * 2);
    const known = albums.filter((a) => a.id).map((a) => a.id as number);
    const stats = known.length ? await this.req<RawAlbum[]>(`/album?${known.map((id) => `albumIds=${id}`).join("&")}`) : [];
    const byId = new Map(stats.map((a) => [a.id, a]));
    const activity = await this.activity();
    return albums
      .map((a) => this.toAlbum(a.id ? { ...a, statistics: byId.get(a.id)?.statistics, monitored: byId.get(a.id)?.monitored ?? a.monitored } : a, activity))
      .filter((a) => a.state !== "available")
      .slice(0, RESULTS);
  }

  async albumStates(foreignIds: string[]): Promise<LidarrAlbum[]> {
    const albums = (await Promise.all(foreignIds.map((f) => this.req<RawAlbum[]>(`/album?foreignAlbumId=${encodeURIComponent(f)}`)))).flat();
    const activity = await this.activity();
    return albums.map((a) => this.toAlbum(a, activity));
  }

  private async defaults() {
    const [roots, qualities, metadata] = await Promise.all([
      this.req<RootFolder[]>("/rootfolder"),
      this.req<Profile[]>("/qualityprofile"),
      this.req<Profile[]>("/metadataprofile"),
    ]);
    const root = roots.find((r) => r.path === this.rootFolder) ?? roots[0];
    if (!root) throw new LidarrError("Lidarr has no root folder");
    const quality = qualities.find((q) => q.name === this.qualityProfile)?.id ?? root.defaultQualityProfileId ?? qualities[0]?.id;
    const meta = root.defaultMetadataProfileId ?? metadata.find((m) => m.name === "Standard")?.id ?? metadata[0]?.id;
    if (!quality || !meta) throw new LidarrError("Lidarr has no quality or metadata profile");
    return { rootFolderPath: root.path, qualityProfileId: quality, metadataProfileId: meta };
  }

  async getAlbum(foreignAlbumId: string): Promise<LidarrAlbum> {
    const existing = (await this.req<RawAlbum[]>(`/album?foreignAlbumId=${encodeURIComponent(foreignAlbumId)}`))[0];
    let id = existing?.id;
    if (!id) {
      const lookup = (await this.req<RawAlbum[]>(`/album/lookup?term=${encodeURIComponent(`lidarr:${foreignAlbumId}`)}`))[0];
      if (!lookup?.artist) throw new LidarrError("Lidarr couldn't find that album on MusicBrainz");
      const d = await this.defaults();
      const artist = lookup.artist.id ? lookup.artist : { ...lookup.artist, ...d, monitored: false, monitorNewItems: "none" };
      const added = await this.req<RawAlbum>("/album", {
        method: "POST",
        body: JSON.stringify({ ...lookup, artist, monitored: true, addOptions: { searchForNewAlbum: false } }),
      });
      id = added.id;
    } else if (!existing?.monitored) {
      await this.req("/album/monitor", { method: "PUT", body: JSON.stringify({ albumIds: [id], monitored: true }) });
    }
    if (!id) throw new LidarrError("Lidarr didn't add the album");
    await this.req("/command", { method: "POST", body: JSON.stringify({ name: "AlbumSearch", albumIds: [id] }) });
    const [state] = await this.albumStates([foreignAlbumId]);
    return state ?? { foreignAlbumId, title: "", artist: "", foreignArtistId: "", year: null, trackCount: null, coverUrl: null, state: "searching", progress: null };
  }

  async lookupArtists(names: string[]): Promise<LidarrArtist[]> {
    const found = await Promise.all(names.map(async (name) => {
      const r = (await this.req<RawArtist[]>(`/artist/lookup?term=${encodeURIComponent(name)}`))[0];
      if (!r) return null;
      return { foreignArtistId: r.foreignArtistId, name: r.artistName, imageUrl: this.cover(r.images) ?? r.images?.[0]?.remoteUrl ?? null, inLidarr: Boolean(r.id && r.monitored) };
    }));
    return found.filter((a): a is LidarrArtist => a !== null);
  }

  async addArtist(foreignArtistId: string): Promise<void> {
    const existing = (await this.req<RawArtist[]>("/artist")).find((a) => a.foreignArtistId === foreignArtistId);
    if (existing?.id) {
      const albums = (await this.req<RawAlbum[]>(`/album?artistId=${existing.id}`))
        .filter((a) => !a.albumType || KEEP_TYPES.has(a.albumType))
        .sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));
      const latest = albums[0];
      if (latest) await this.getAlbum(latest.foreignAlbumId);
      return;
    }
    const lookup = (await this.req<RawArtist[]>(`/artist/lookup?term=${encodeURIComponent(`lidarr:${foreignArtistId}`)}`))[0];
    if (!lookup) throw new LidarrError("Lidarr couldn't find that artist on MusicBrainz");
    await this.req("/artist", {
      method: "POST",
      body: JSON.stringify({
        ...lookup, ...(await this.defaults()), monitored: true, monitorNewItems: "none",
        addOptions: { monitor: "latest", searchForMissingAlbums: true },
      }),
    });
  }
}
