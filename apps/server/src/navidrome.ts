import type { SubsonicEnvelope } from "@needle/shared";
import { AUTH_HEADERS } from "@needle/shared";

export type Auth = { user: string; token: string; salt: string };

export class SubsonicFailure extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

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
    if (r.status !== "ok") throw new SubsonicFailure(r.error?.code ?? 0, r.error?.message ?? "Navidrome request failed");
    return r;
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
