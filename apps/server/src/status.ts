import { constants } from "node:fs";
import { access, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { CheckState, ConnectionCheck } from "@needle/shared";
import { DAY_MS } from "@needle/shared";
import type { Config } from "./config.ts";
import type { Deezer } from "./deezer.ts";
import type { Lidarr } from "./lidarr.ts";
import type { ListenBrainz } from "./listenbrainz.ts";
import type { MusicBrainz } from "./musicbrainz.ts";
import type { Auth, Navidrome } from "./navidrome.ts";
import type { LibrarySearch } from "./search.ts";
import type { Slskd } from "./soulseek.ts";
import type { YouTubeMusic } from "./youtube-music.ts";

const TTL_MS = 30_000;
const SAMPLE_FILES = 3;
const LISTEN_WINDOW_MS = 7 * DAY_MS;
const AUDIO = /\.(flac|mp3|m4a|aac|ogg|opus|wav|alac|aiff?|wma)$/i;

type Deps = {
  config: Config;
  navidrome: Navidrome;
  library: LibrarySearch;
  lidarr: Lidarr | null;
  slskd: Slskd | null;
  musicbrainz: MusicBrainz;
  deezer: Deezer;
  listenbrainz: ListenBrainz;
  youtubeMusic?: YouTubeMusic | null;
};
type Outcome = { state: CheckState; detail: string; fix?: string };
type Check = { id: string; label: string; fix: string; run: () => Promise<Outcome> };

const off = (detail: string, fix: string): Outcome => ({ state: "off", detail, fix });

function spotifyOutcome(config: Config): Outcome {
  if (!config.spotify)
    return off("Not set up", "Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET from a Spotify developer app.");
  if (!config.publicUrl)
    return {
      state: "warn",
      detail: "PUBLIC_URL isn't set, so Spotify sign-in can't return to Needle",
      fix: "Set PUBLIC_URL to the https:// address people open.",
    };
  return { state: "ok", detail: `Redirect URI to register with Spotify: ${config.publicUrl}/api/spotify/callback` };
}

async function sampleFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile() && AUDIO.test(e.name))
    .slice(0, SAMPLE_FILES)
    .map((e) => join(e.parentPath, e.name));
}

export class Status {
  private readonly d: Deps;
  private cached: { at: number; checks: Promise<ConnectionCheck[]> } | null = null;

  constructor(deps: Deps) {
    this.d = deps;
  }

  checks(auth: Auth, fresh = false): Promise<ConnectionCheck[]> {
    if (!fresh && this.cached && Date.now() - this.cached.at < TTL_MS) return this.cached.checks;
    const checks = Promise.all(this.list(auth).map((c) => this.run(c)));
    this.cached = { at: Date.now(), checks };
    return checks;
  }

  private async run(c: Check): Promise<ConnectionCheck> {
    const outcome = await c.run().catch((e: unknown): Outcome => ({
      state: "fail",
      detail: e instanceof Error ? e.message : String(e),
      fix: c.fix,
    }));
    return { id: c.id, label: c.label, ...outcome };
  }

  private list(auth: Auth): Check[] {
    const { config, navidrome, library, lidarr, slskd, musicbrainz, deezer, listenbrainz } = this.d;
    const soulseek = config.soulseek;
    const songsOff = off("Used only for single songs", "Set SLSKD_URL and SLSKD_API_KEY to turn on single songs.");
    return [
      {
        id: "navidrome",
        label: "Navidrome",
        fix: "Check NAVIDROME_URL: Navidrome's address as Needle's server reaches it, such as http://navidrome:4533 in Docker.",
        run: async () => {
          const ping = await navidrome.call<{ serverVersion?: string; version: string }>(auth, "ping");
          const folders = await navidrome.call<{ musicFolders: { musicFolder?: { name: string }[] } }>(
            auth,
            "getMusicFolders",
          );
          const names = folders.musicFolders.musicFolder?.map((f) => f.name) ?? [];
          return {
            state: "ok",
            detail: `Version ${ping.serverVersion ?? ping.version}. Libraries: ${names.join(", ") || "none"}`,
          };
        },
      },
      {
        id: "lidarr",
        label: "Lidarr (albums)",
        fix: "Check LIDARR_URL and LIDARR_API_KEY (Lidarr → Settings → General → API Key).",
        run: async () => {
          if (!lidarr) return off("Not set up", "Set LIDARR_URL and LIDARR_API_KEY to fetch whole albums.");
          const r = await lidarr.check();
          const detail = `Version ${r.version}. Albums go to ${r.rootFolder ?? "no root folder"}`;
          return r.problems.length ? { state: "warn", detail, fix: r.problems.join(". ") } : { state: "ok", detail };
        },
      },
      {
        id: "slskd",
        label: "slskd (single songs)",
        fix: "Check SLSKD_URL and SLSKD_API_KEY (an API key under web → authentication → api_keys in slskd's settings).",
        run: async () => {
          if (!slskd) return off("Not set up", "Set SLSKD_URL and SLSKD_API_KEY to fetch single songs from Soulseek.");
          const app = await slskd.application();
          const detail = `Version ${app.version.current}. Soulseek: ${app.server.state}`;
          return app.server.isLoggedIn
            ? { state: "ok", detail }
            : {
                state: "warn",
                detail,
                fix: "slskd isn't signed in to Soulseek. Check the Soulseek username and password in slskd's settings.",
              };
        },
      },
      {
        id: "folders",
        label: "Song folders",
        fix: "Mount slskd's downloads folder at SOULSEEK_DIR and a writable folder at SINGLES_DIR. The image runs as uid 1000; set user: in compose if your files belong to someone else.",
        run: async () => {
          if (!soulseek) return songsOff;
          await access(soulseek.downloadsDir, constants.R_OK).catch(() => {
            throw new Error(`Can't read SOULSEEK_DIR (${soulseek.downloadsDir})`);
          });
          const probe = join(soulseek.singlesDir, `.needle-check-${process.pid}`);
          await writeFile(probe, "").catch(() => {
            throw new Error(`Can't write to SINGLES_DIR (${soulseek.singlesDir})`);
          });
          await unlink(probe);
          return { state: "ok", detail: `Reads ${soulseek.downloadsDir}, writes ${soulseek.singlesDir}` };
        },
      },
      {
        id: "singles-library",
        label: "Singles in Navidrome",
        fix: "In Navidrome, add a library for the folder Needle writes to (SINGLES_DIR), give your users access to it, and let it scan. Libraries need Navidrome 0.58 or later.",
        run: async () => {
          if (!soulseek) return songsOff;
          const files = await sampleFiles(soulseek.singlesDir);
          if (!files.length)
            return off("Nothing fetched yet. Checked after the first song", "Get a song, then check again.");
          const found = await Promise.all(
            files.map(async (f) => library.hasFile(auth, (await stat(f)).size, extname(f).slice(1).toLowerCase())),
          );
          if (found.some(Boolean)) return { state: "ok", detail: "Navidrome lists the songs Needle fetched" };
          throw new Error("Navidrome doesn't list the songs in SINGLES_DIR");
        },
      },
      {
        id: "lookups",
        label: "Song lookups",
        fix: "Song search asks musicbrainz.org (and api.deezer.com for popular songs). Needle's server needs outbound internet.",
        run: async () => {
          if (!soulseek) return songsOff;
          await musicbrainz.ping();
          return (await deezer.ping())
            ? { state: "ok", detail: "MusicBrainz and Deezer answer" }
            : {
                state: "warn",
                detail: "MusicBrainz answers, Deezer doesn't",
                fix: "Popular songs for an artist's name need api.deezer.com.",
              };
        },
      },
      {
        id: "listenbrainz",
        label: "ListenBrainz (discovery)",
        fix: "Needle's server needs to reach api.listenbrainz.org (LISTENBRAINZ_URL).",
        run: async () => {
          const account = listenbrainz.account(auth.user);
          if (!account) return off("Not connected", "Connect ListenBrainz in Settings to get its weekly playlists.");
          const last = await listenbrainz.lastListen(auth.user);
          if (last && Date.now() - last.at < LISTEN_WINDOW_MS) {
            const days = Math.floor((Date.now() - last.at) / DAY_MS);
            return {
              state: "ok",
              detail: `Connected as ${account.user}. Navidrome sent a listen ${days < 1 ? "today" : days === 1 ? "yesterday" : `${days} days ago`}`,
            };
          }
          return {
            state: "warn",
            detail: `Connected as ${account.user}, but Navidrome hasn't sent a listen in 7 days`,
            fix: "In Navidrome, open Settings → Personal → ListenBrainz and paste your ListenBrainz token, or connect again in Needle's Settings with your Navidrome password.",
          };
        },
      },
      {
        id: "spotify",
        label: "Spotify",
        fix: "Check SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and PUBLIC_URL.",
        run: () => Promise.resolve(spotifyOutcome(config)),
      },
      ...(["metadata", "resolver"] as const).map((component): Check => ({
        id: `youtube-music-${component}`,
        label: component === "metadata" ? "YouTube Music" : "YouTube Music playback",
        fix: "Set YTMUSIC_CLIENT_ID and YTMUSIC_CLIENT_SECRET, then run uv sync in bridges/youtube-music.",
        run: async () => {
          if (!this.d.youtubeMusic)
            return off("Not set up", "Set YTMUSIC_CLIENT_ID and YTMUSIC_CLIENT_SECRET to connect YouTube Music.");

          const version = await this.d.youtubeMusic.health(component);

          return {
            state: "ok",
            detail: `${component === "metadata" ? "ytmusicapi" : "yt-dlp"} ${version}. Experimental integration.`,
          };
        },
      })),
    ];
  }
}
