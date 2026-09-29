import type { DatabaseSync } from "node:sqlite";
import type { DiscoveryDetail, DiscoveryKind, DiscoveryPlaylist, DiscoveryTrack, ListenBrainzLink, ListenBrainzUnlink, Song } from "@needle/shared";
import { HOUR_MS } from "@needle/shared";
import type { Auth, Navidrome } from "./navidrome.ts";
import { NavidromeError } from "./navidrome.ts";
import type { Requests } from "./requests.ts";
import { toItem } from "./requests.ts";
import type { LibrarySearch, Matcher } from "./search.ts";
import { findSong } from "./search.ts";
import { USER_AGENT } from "./version.ts";

const GAP_MS = 1100;
const TIMEOUT_MS = 15_000;
const LISTS_TTL = HOUR_MS;
const PLAYLIST_TTL = 24 * HOUR_MS;
const COVERS = 4;
const MAX_PLAYLISTS = 8;
const RECENT_LISTENS = 25;
const KINDS: DiscoveryKind[] = ["weekly-exploration", "weekly-jams", "daily-jams"];
const MBID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const BAD_TOKEN = "ListenBrainz didn't accept that token. Copy it again from listenbrainz.org/settings.";
const NOT_CONNECTED = "Connect ListenBrainz in Settings first";

type JspfTrack = {
  identifier?: string | string[];
  title?: string;
  creator?: string;
  album?: string;
  duration?: number;
  extension?: { "https://musicbrainz.org/doc/jspf#track"?: { additional_metadata?: { caa_release_mbid?: string | null; caa_id?: number | string | null } } };
};
export type Jspf = {
  identifier?: string | string[];
  title?: string;
  annotation?: string;
  date?: string;
  track?: JspfTrack[];
  extension?: { "https://musicbrainz.org/doc/jspf#playlist"?: { additional_metadata?: { algorithm_metadata?: { source_patch?: string } } } };
};
type Listen = { listened_at: number; track_metadata?: { additional_info?: { submission_client?: string } } };
type Row = { token: string; lb_user: string; navidrome_linked: number };
type Cached<T> = { at: number; value: Promise<T> };
export type Track = Omit<DiscoveryTrack, "song" | "request">;
export type Parsed = Omit<DiscoveryPlaylist, "covers" | "coverArts" | "total" | "inLibrary"> & { patch: string; tracks: Track[] };
type Deps = { url: string; db: DatabaseSync; navidrome: Navidrome; library: LibrarySearch; requests: Requests };

export class ListenBrainzError extends Error {
  readonly status: 400 | 404 | 409 | 502;
  constructor(status: ListenBrainzError["status"], message: string) {
    super(message);
    this.status = status;
  }
}

const mbidOf = (identifier: string | string[] | undefined) => [identifier ?? []].flat().map((i) => MBID.exec(i)?.[0]).find(Boolean)?.toLowerCase() ?? null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function parsePlaylist(p: Jspf, user: string): Parsed | null {
  const id = mbidOf(p.identifier);
  if (!id) return null;
  const patch = p.extension?.["https://musicbrainz.org/doc/jspf#playlist"]?.additional_metadata?.algorithm_metadata?.source_patch ?? p.title ?? id;
  const tracks = (p.track ?? []).flatMap((t): Track[] => {
    const mbid = mbidOf(t.identifier);
    if (!mbid || !t.title) return [];
    const caa = t.extension?.["https://musicbrainz.org/doc/jspf#track"]?.additional_metadata;
    return [{
      mbid, title: t.title, artist: t.creator ?? "", album: t.album ?? null,
      duration: t.duration ? Math.round(t.duration / 1000) : null,
      coverUrl: caa?.caa_release_mbid && caa.caa_id ? `https://coverartarchive.org/release/${caa.caa_release_mbid}/${caa.caa_id}-250.jpg` : null,
    }];
  });
  const kind = KINDS.find((k) => k === patch) ?? "other";
  const name = p.title?.split(` for ${user}`)[0]?.trim() ?? "";
  return { id, name: name || "ListenBrainz playlist", kind, patch, description: p.annotation ?? "", date: p.date ?? "", tracks };
}

export function newestPerKind(playlists: Parsed[]): Parsed[] {
  const newest = new Map<string, Parsed>();
  for (const p of playlists) {
    const seen = newest.get(p.patch);
    if (!seen || p.date > seen.date) newest.set(p.patch, p);
  }
  const rank = (p: Parsed) => (p.kind === "other" ? KINDS.length : KINDS.indexOf(p.kind));
  return [...newest.values()].sort((a, b) => rank(a) - rank(b) || b.date.localeCompare(a.date)).slice(0, MAX_PLAYLISTS);
}

const distinct = (values: (string | null | undefined)[]) => [...new Set(values.filter((v): v is string => Boolean(v)))].slice(0, COVERS);

function summary(p: Parsed, songs: (Song | undefined)[]): DiscoveryPlaylist {
  return {
    id: p.id, name: p.name, kind: p.kind, description: p.description, date: p.date,
    covers: distinct(p.tracks.map((t) => t.coverUrl)), coverArts: distinct(songs.map((s) => s?.coverArt)),
    total: p.tracks.length, inLibrary: songs.filter(Boolean).length,
  };
}

const matchAll = (p: Parsed, m: Matcher) => p.tracks.map((t) => findSong(m, t));

export class ListenBrainz {
  private readonly d: Deps;
  private next = 0;
  private readonly lists = new Map<string, Cached<Parsed[]>>();
  private readonly jspf = new Map<string, Cached<Parsed>>();

  constructor(deps: Deps) {
    this.d = deps;
  }

  account(user: string): { user: string; navidrome: boolean } | null {
    const row = this.row(user);
    return row ? { user: row.lb_user, navidrome: Boolean(row.navidrome_linked) } : null;
  }

  async connect(auth: Auth, token: string, password?: string): Promise<ListenBrainzLink> {
    const r = await this.get<{ valid?: boolean; user_name?: string }>("/1/validate-token", token);
    if (!r.valid || !r.user_name) throw new ListenBrainzError(400, BAD_TOKEN);
    const before = this.row(auth.user);
    const link = password ? await this.navidromeLink(auth.user, password, token) : { navidrome: before?.token === token && Boolean(before.navidrome_linked) };
    this.d.db.prepare(`INSERT INTO listenbrainz (user, token, lb_user, navidrome_linked, connected_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user) DO UPDATE SET token = excluded.token, lb_user = excluded.lb_user, navidrome_linked = excluded.navidrome_linked, connected_at = excluded.connected_at`)
      .run(auth.user, token, r.user_name, link.navidrome ? 1 : 0, Date.now());
    this.lists.delete(r.user_name);
    return { user: r.user_name, ...link };
  }

  async disconnect(auth: Auth, password?: string): Promise<ListenBrainzUnlink> {
    const link = password ? await this.navidromeLink(auth.user, password, null) : { navidrome: false };
    const row = this.row(auth.user);
    if (row) this.lists.delete(row.lb_user);
    this.d.db.prepare("DELETE FROM listenbrainz WHERE user = ?").run(auth.user);
    return link;
  }

  async playlists(auth: Auth): Promise<DiscoveryPlaylist[]> {
    const row = this.connected(auth.user);
    const listed = await this.cached(this.lists, row.lb_user, LISTS_TTL, async () => {
      const r = await this.get<{ playlists?: { playlist: Jspf }[] }>(`/1/user/${encodeURIComponent(row.lb_user)}/playlists/createdfor`, row.token);
      return newestPerKind((r.playlists ?? []).map((p) => parsePlaylist(p.playlist, row.lb_user)).filter((p): p is Parsed => Boolean(p)));
    });
    const [m, full] = await Promise.all([this.d.library.matcher(auth), Promise.all(listed.map((p) => this.load(p.id, row).catch(() => null)))]);
    return full.filter((p): p is Parsed => Boolean(p)).map((p) => summary(p, matchAll(p, m)));
  }

  async playlist(auth: Auth, mbid: string): Promise<DiscoveryDetail> {
    const row = this.connected(auth.user);
    const [p, m] = await Promise.all([this.load(mbid, row), this.d.library.matcher(auth)]);
    const songs = matchAll(p, m);
    const missing = p.tracks.filter((_, i) => !songs[i]).map((t) => t.mbid);
    const requests = new Map(this.d.requests.byRefs(auth.user, "song", missing).map((r) => [r.ref, toItem(r)]));
    return {
      ...summary(p, songs),
      tracks: p.tracks.map((t, i) => ({ ...t, song: songs[i] ?? null, request: songs[i] ? null : requests.get(t.mbid) ?? null })),
    };
  }

  async lastListen(user: string): Promise<{ at: number; client: string } | null> {
    const row = this.connected(user);
    const r = await this.get<{ payload?: { listens?: Listen[] } }>(`/1/user/${encodeURIComponent(row.lb_user)}/listens?count=${RECENT_LISTENS}`, row.token);
    const listens = r.payload?.listens ?? [];
    const clientOf = (l: Listen) => l.track_metadata?.additional_info?.submission_client ?? "";
    const l = listens.find((x) => /navidrome/i.test(clientOf(x)));
    return l ? { at: l.listened_at * 1000, client: clientOf(l) } : null;
  }

  private row(user: string): Row | undefined {
    return this.d.db.prepare("SELECT token, lb_user, navidrome_linked FROM listenbrainz WHERE user = ?").get(user) as Row | undefined;
  }

  private connected(user: string): Row {
    const row = this.row(user);
    if (!row) throw new ListenBrainzError(409, NOT_CONNECTED);
    return row;
  }

  private async navidromeLink(user: string, password: string, token: string | null): Promise<ListenBrainzUnlink> {
    try {
      await this.d.navidrome.linkListenBrainz(user, password, token);
      return { navidrome: true };
    } catch (e) {
      return { navidrome: false, navidromeError: e instanceof NavidromeError ? e.message : "Navidrome couldn't change its ListenBrainz setting" };
    }
  }

  private load(mbid: string, row: Row): Promise<Parsed> {
    return this.cached(this.jspf, mbid, PLAYLIST_TTL, async () => {
      const r = await this.get<{ playlist?: Jspf }>(`/1/playlist/${mbid}`, row.token);
      const p = r.playlist ? parsePlaylist(r.playlist, row.lb_user) : null;
      if (!p) throw new ListenBrainzError(502, "ListenBrainz sent a playlist Needle can't read");
      return p;
    });
  }

  private cached<T>(map: Map<string, Cached<T>>, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = map.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const value = load();
    map.set(key, { at: Date.now(), value });
    value.catch(() => map.delete(key));
    return value;
  }

  private async get<T>(path: string, token: string | null, retried = false): Promise<T> {
    const wait = this.next - Date.now();
    this.next = Math.max(Date.now(), this.next) + GAP_MS;
    if (wait > 0) await sleep(wait);
    const res = await fetch(`${this.d.url}${path}`, {
      headers: { "user-agent": USER_AGENT, accept: "application/json", ...(token ? { authorization: `Token ${token}` } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => {
      throw new ListenBrainzError(502, "ListenBrainz isn't responding");
    });
    const resetMs = Math.max(1, Number(res.headers.get("x-ratelimit-reset-in") ?? 1)) * 1000;
    if (res.status === 429 || res.headers.get("x-ratelimit-remaining") === "0") this.next = Math.max(this.next, Date.now() + resetMs);
    if (res.status === 429 && !retried) return this.get(path, token, true);
    if (res.status === 404) throw new ListenBrainzError(404, "ListenBrainz doesn't have that playlist anymore");
    if (res.status === 400 || res.status === 401) throw new ListenBrainzError(400, BAD_TOKEN);
    if (!res.ok) throw new ListenBrainzError(502, `ListenBrainz answered ${res.status}`);
    return (await res.json()) as T;
  }
}
