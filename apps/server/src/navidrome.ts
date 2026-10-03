import type { Playlist, SubsonicEnvelope } from "@needle/shared";
import { AUTH_HEADERS } from "@needle/shared";

export type Auth = { user: string; token: string; salt: string };

export class SubsonicFailure extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export class NavidromeError extends Error {}

const CLIENT = "needle-server";
const DOWN = -1;
const VALID_FOR_MS = 5 * 60_000;

export class Navidrome {
  readonly url: string;
  private readonly verified = new Map<string, number>();

  constructor(url: string) {
    this.url = url;
  }

  query(auth: Auth, params: Record<string, string | number | boolean | string[] | undefined> = {}) {
    const q = new URLSearchParams({ u: auth.user, t: auth.token, s: auth.salt, v: "1.16.1", c: CLIENT, f: "json" });
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) q.append(k, String(item));
    }
    return q;
  }

  async call<T>(auth: Auth, method: string, params: Parameters<Navidrome["query"]>[1] = {}): Promise<T> {
    const res = await fetch(`${this.url}/rest/${method}`, {
      method: "POST",
      headers: { "accept-encoding": "identity", "content-type": "application/x-www-form-urlencoded" },
      body: this.query(auth, params),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => {
      throw new SubsonicFailure(DOWN, "Navidrome isn't responding");
    });
    const body = (await res.json()) as SubsonicEnvelope<T>;
    const r = body["subsonic-response"];
    if (r.status !== "ok")
      throw new SubsonicFailure(r.error?.code ?? 0, r.error?.message ?? "Navidrome request failed");
    return r;
  }

  async upsertPlaylist(auth: Auth, name: string, songIds: string[]): Promise<string> {
    const { playlists } = await this.call<{ playlists: { playlist?: Playlist[] } }>(auth, "getPlaylists");
    const existing = (playlists.playlist ?? []).find((p) => p.name === name && (p.owner ?? auth.user) === auth.user);
    const r = await this.call<{ playlist: Playlist }>(
      auth,
      "createPlaylist",
      existing ? { playlistId: existing.id, songId: songIds } : { name, songId: songIds },
    );
    return r.playlist.id;
  }

  async linkListenBrainz(user: string, password: string, token: string | null): Promise<void> {
    const send = (path: string, init: RequestInit) =>
      fetch(`${this.url}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...init.headers },
        signal: AbortSignal.timeout(20_000),
      }).catch(() => {
        throw new NavidromeError("Navidrome isn't responding");
      });
    const login = await send("/auth/login", { method: "POST", body: JSON.stringify({ username: user, password }) });
    if (login.status === 401) throw new NavidromeError("Navidrome didn't accept that password");
    if (login.status === 429) throw new NavidromeError("Navidrome is limiting sign-ins. Try again in a minute.");
    if (!login.ok) throw new NavidromeError(`Navidrome answered ${login.status} to the sign-in`);
    const { token: jwt } = (await login.json()) as { token: string };
    const link = await send("/api/listenbrainz/link", {
      method: token ? "PUT" : "DELETE",
      headers: { "x-nd-authorization": `Bearer ${jwt}` },
      ...(token ? { body: JSON.stringify({ token }) } : {}),
    });
    if (link.status === 404)
      throw new NavidromeError("ListenBrainz is switched off in Navidrome (ND_LISTENBRAINZ_ENABLED)");
    if (!link.ok) throw new NavidromeError(`Navidrome answered ${link.status} when linking ListenBrainz`);
  }

  async verify(auth: Auth): Promise<"ok" | "denied" | "down"> {
    const key = `${auth.user}\0${auth.token}\0${auth.salt}`;
    const until = this.verified.get(key);
    if (until && until > Date.now()) return "ok";
    try {
      await this.call(auth, "ping");
      this.verified.set(key, Date.now() + VALID_FOR_MS);
      return "ok";
    } catch (e) {
      this.verified.delete(key);
      return e instanceof SubsonicFailure && e.code === DOWN ? "down" : "denied";
    }
  }
}

export function authFromHeaders(headers: Headers): Auth | null {
  const user = headers.get(AUTH_HEADERS.user);
  const token = headers.get(AUTH_HEADERS.token);
  const salt = headers.get(AUTH_HEADERS.salt);
  return user && token && salt ? { user, token, salt } : null;
}

export function authFromQuery(url: URL): Auth | null {
  const user = url.searchParams.get("u");
  const token = url.searchParams.get("t");
  const salt = url.searchParams.get("s");
  return user && token && salt ? { user, token, salt } : null;
}
