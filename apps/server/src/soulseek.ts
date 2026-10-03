import { copyFile, mkdir, readdir, rename, rmdir, stat, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { SongCandidate } from "@needle/shared";
import { fold, OTHER_VERSIONS, queryTerms } from "@needle/shared";
import type { Auth, Navidrome } from "./navidrome.ts";
import type { Requests } from "./requests.ts";

export type SlskdFile = { filename: string; size: number; bitRate?: number; length?: number; extension?: string };
export type SlskdResponse = {
  username: string;
  files: SlskdFile[];
  hasFreeUploadSlot: boolean;
  uploadSpeed: number;
  queueLength: number;
};
type Transfer = {
  id: string;
  username: string;
  filename: string;
  state: string;
  percentComplete: number;
  size: number;
};
type Search = { id: string; isComplete: boolean };
export type FilePick = { username: string; file: SlskdFile };

const AUDIO = new Set(["flac", "mp3", "m4a", "ogg", "opus", "wav"]);
const LOSSLESS = new Set(["flac", "wav"]);
const DURATION_SLACK_S = 5;
const SEARCH_WAIT_MS = 20_000;
const POLL_MS = 3_000;
const QUEUE_GIVE_UP_MS = 3 * 60_000;
const DOWNLOAD_GIVE_UP_MS = 20 * 60_000;
const ATTEMPTS = 3;
const PARALLEL = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const parts = (remote: string) => remote.split(/[\\/]/).filter(Boolean);
const ext = (f: SlskdFile) => (f.extension ?? extname(f.filename).slice(1)).toLowerCase();

function tier(f: SlskdFile): number {
  const e = ext(f);
  if (!AUDIO.has(e)) return 0;
  if (LOSSLESS.has(e)) return 3;
  const kbps = f.bitRate ?? 0;
  return kbps >= 310 ? 2 : kbps >= 250 ? 1 : 0;
}

export function pickFiles(
  responses: SlskdResponse[],
  want: Pick<SongCandidate, "title" | "artist" | "duration">,
): FilePick[] {
  const title = queryTerms(want.title.replace(/\(.*?\)|\[.*?\]/g, " ")).filter((t) => t.length > 1);
  const artist = queryTerms(want.artist).filter((t) => t.length > 1);
  const allowed = OTHER_VERSIONS.filter((w) => !fold(want.title).includes(w));
  const scored: (FilePick & { score: number })[] = [];
  for (const r of responses) {
    for (const file of r.files) {
      const q = tier(file);
      const name = fold(parts(file.filename).at(-1) ?? "");
      const path = fold(file.filename);
      if (!q || !title.every((t) => name.includes(t)) || allowed.some((w) => new RegExp(`\\b${w}\\b`).test(name)))
        continue;
      const known = Boolean(want.duration && file.length);
      if (known && Math.abs((file.length ?? 0) - (want.duration ?? 0)) > DURATION_SLACK_S) continue;
      const score =
        q * 100 +
        (artist.every((t) => path.includes(t)) ? 20 : 0) +
        (known ? 10 : 0) +
        (r.hasFreeUploadSlot ? 15 : 0) +
        Math.min(r.uploadSpeed / 1_000_000, 10) -
        Math.min(r.queueLength, 20);
      scored.push({ username: r.username, file, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score).map(({ username, file }) => ({ username, file }));
}

const safe = (s: string) =>
  s
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "Unknown";

export function singlePath(dir: string, want: Pick<SongCandidate, "title" | "artist">, file: SlskdFile): string {
  return join(dir, safe(want.artist), `${safe(want.artist)} - ${safe(want.title)}.${ext(file)}`);
}

export class SlskdError extends Error {}

export class Slskd {
  private readonly url: string;
  private readonly apiKey: string;

  constructor(url: string, apiKey: string) {
    this.url = url;
    this.apiKey = apiKey;
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.url}/api/v0${path}`, {
      ...init,
      headers: { "x-api-key": this.apiKey, "content-type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => {
      throw new SlskdError("slskd isn't responding");
    });
    if (!res.ok) throw new SlskdError(`slskd answered ${res.status}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  application() {
    return this.req<{ version: { current: string }; server: { state: string; isLoggedIn: boolean } }>("/application");
  }

  async search(text: string): Promise<SlskdResponse[]> {
    const search = await this.req<Search>("/searches", { method: "POST", body: JSON.stringify({ searchText: text }) });
    const until = Date.now() + SEARCH_WAIT_MS;
    while (Date.now() < until && !(await this.req<Search>(`/searches/${search.id}`)).isComplete)
      await sleep(POLL_MS / 2);
    const responses = await this.req<SlskdResponse[]>(`/searches/${search.id}/responses`);
    await this.req(`/searches/${search.id}`, { method: "DELETE" }).catch(() => undefined);
    return responses;
  }

  download(p: FilePick) {
    return this.req(`/transfers/downloads/${encodeURIComponent(p.username)}`, {
      method: "POST",
      body: JSON.stringify([{ filename: p.file.filename, size: p.file.size }]),
    });
  }

  async transfer(p: FilePick): Promise<Transfer | undefined> {
    const user = await this.req<{ directories?: { files: Transfer[] }[] }>(
      `/transfers/downloads/${encodeURIComponent(p.username)}`,
    ).catch(() => ({ directories: [] }));
    return (user.directories ?? []).flatMap((d) => d.files).find((f) => f.filename === p.file.filename);
  }

  remove(t: Transfer) {
    return this.req(`/transfers/downloads/${encodeURIComponent(t.username)}/${t.id}?remove=true`, {
      method: "DELETE",
    }).catch(() => undefined);
  }
}

type Deps = { slskd: Slskd; requests: Requests; navidrome: Navidrome; downloadsDir: string; singlesDir: string };

export class SongDownloads {
  private readonly d: Deps;
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(deps: Deps) {
    this.d = deps;
    for (const row of deps.requests.active())
      deps.requests.update(row.id, { state: "failed", detail: "Needle restarted during the download. Try again." });
  }

  start(auth: Auth, song: SongCandidate) {
    const row = this.d.requests.add({
      user: auth.user,
      kind: "song",
      ref: song.id,
      title: song.title,
      artist: song.artist,
      cover_url: song.coverUrl,
      state: "searching",
    });
    void this.slot(() => this.run(row.id, auth, song)).catch((e: unknown) =>
      this.d.requests.update(row.id, {
        state: "failed",
        detail: e instanceof Error ? e.message : "The download failed",
      }),
    );
    return row;
  }

  private async slot(job: () => Promise<void>) {
    if (this.running < PARALLEL) this.running++;
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
    try {
      await job();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }

  private async run(id: number, auth: Auth, song: SongCandidate) {
    const { slskd, requests } = this.d;
    const picks = pickFiles(
      await slskd.search(`${song.artist} ${song.title}`.replace(/[^\p{L}\p{N}\s]/gu, " ")),
      song,
    ).slice(0, ATTEMPTS);
    if (!picks.length) throw new Error("No good copy on Soulseek right now. Try again later.");
    for (const pick of picks) {
      requests.update(id, {
        state: "downloading",
        progress: 0,
        transfer: JSON.stringify({ username: pick.username, filename: pick.file.filename }),
      });
      const done = await this.follow(id, pick);
      if (!done) continue;
      requests.update(id, { state: "moving", progress: 1 });
      await this.move(pick, singlePath(this.d.singlesDir, song, pick.file));
      await slskd.remove(done);
      await this.d.navidrome.call(auth, "startScan").catch(() => undefined);
      requests.update(id, { state: "available", detail: null });
      return;
    }
    throw new Error("Soulseek users didn't send the file. Try again later.");
  }

  private async follow(id: number, pick: FilePick): Promise<Transfer | null> {
    await this.d.slskd.download(pick);
    const started = Date.now();
    for (;;) {
      await sleep(POLL_MS);
      const t = await this.d.slskd.transfer(pick);
      if (t?.state.startsWith("Completed")) return t.state.includes("Succeeded") ? t : null;
      if (t) this.d.requests.update(id, { progress: t.percentComplete / 100 });
      const waited = Date.now() - started;
      if ((!t?.percentComplete && waited > QUEUE_GIVE_UP_MS) || waited > DOWNLOAD_GIVE_UP_MS) {
        if (t) await this.d.slskd.remove(t);
        return null;
      }
    }
  }

  private async local(pick: FilePick): Promise<string> {
    const segs = parts(pick.file.filename);
    const name = segs.at(-1) ?? "";
    const expected = join(this.d.downloadsDir, segs.at(-2) ?? "", name);
    if (
      await stat(expected).then(
        () => true,
        () => false,
      )
    )
      return expected;
    for (const dir of await readdir(this.d.downloadsDir, { withFileTypes: true })) {
      const candidate = join(this.d.downloadsDir, dir.name, name);
      if (
        dir.isDirectory() &&
        (await stat(candidate).then(
          (s) => s.size === pick.file.size,
          () => false,
        ))
      )
        return candidate;
    }
    throw new Error(`The downloaded file ${basename(name)} wasn't found`);
  }

  private async move(pick: FilePick, target: string) {
    const from = await this.local(pick);
    await mkdir(join(target, ".."), { recursive: true });
    await rename(from, target).catch(async (e: unknown) => {
      if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
      await copyFile(from, target);
      await unlink(from);
    });
    const folder = join(from, "..");
    if (folder !== this.d.downloadsDir) await rmdir(folder).catch(() => undefined);
  }
}
