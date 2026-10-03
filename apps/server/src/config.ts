import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const YOUTUBE_MUSIC_BRIDGE = fileURLToPath(
  new URL("../../../bridges/youtube-music/src/youtube_music_bridge.py", import.meta.url),
);

const env = (name: string) => {
  const value = process.env[name]?.trim();
  return value === "" ? undefined : value;
};
const trimSlash = (url: string) => url.replace(/\/+$/, "");

export type Config = {
  port: number;
  navidromeUrl: string;
  lidarr: { url: string; apiKey: string; qualityProfile: string | null; rootFolder: string | null } | null;
  spotify: { clientId: string; clientSecret: string } | null;
  youtubeMusic: { clientId: string; clientSecret: string; python: string; bridgePath?: string } | null;
  soulseek: { url: string; apiKey: string; downloadsDir: string; singlesDir: string } | null;
  publicUrl: string | null;
  musicbrainzUrl: string;
  deezerUrl: string;
  listenbrainzUrl: string;
  dataDir: string;
  webDist: string;
  trustedProxy: boolean;
};

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const lidarrUrl = env("LIDARR_URL");
  const lidarrKey = env("LIDARR_API_KEY");
  const spotifyId = env("SPOTIFY_CLIENT_ID");
  const spotifySecret = env("SPOTIFY_CLIENT_SECRET");
  const youtubeMusicId = env("YTMUSIC_CLIENT_ID");
  const youtubeMusicSecret = env("YTMUSIC_CLIENT_SECRET");
  const slskdUrl = env("SLSKD_URL");
  const slskdKey = env("SLSKD_API_KEY");
  const publicUrl = env("PUBLIC_URL");
  return {
    port: Number(env("PORT") ?? 4535),
    navidromeUrl: trimSlash(env("NAVIDROME_URL") ?? "http://127.0.0.1:4533"),
    lidarr:
      lidarrUrl && lidarrKey
        ? {
            url: trimSlash(lidarrUrl),
            apiKey: lidarrKey,
            qualityProfile: env("LIDARR_QUALITY_PROFILE") ?? null,
            rootFolder: env("LIDARR_ROOT_FOLDER") ?? null,
          }
        : null,
    spotify: spotifyId && spotifySecret ? { clientId: spotifyId, clientSecret: spotifySecret } : null,
    youtubeMusic:
      youtubeMusicId && youtubeMusicSecret
        ? {
            clientId: youtubeMusicId,
            clientSecret: youtubeMusicSecret,
            python: env("YTMUSIC_PYTHON") ?? "python3",
            bridgePath: env("YTMUSIC_BRIDGE_PATH") ?? YOUTUBE_MUSIC_BRIDGE,
          }
        : null,
    soulseek:
      slskdUrl && slskdKey
        ? {
            url: trimSlash(slskdUrl),
            apiKey: slskdKey,
            downloadsDir: resolve(env("SOULSEEK_DIR") ?? "/soulseek"),
            singlesDir: resolve(env("SINGLES_DIR") ?? "/singles"),
          }
        : null,
    publicUrl: publicUrl ? trimSlash(publicUrl) : null,
    musicbrainzUrl: trimSlash(env("MUSICBRAINZ_URL") ?? "https://musicbrainz.org/ws/2"),
    deezerUrl: trimSlash(env("DEEZER_URL") ?? "https://api.deezer.com"),
    listenbrainzUrl: trimSlash(env("LISTENBRAINZ_URL") ?? "https://api.listenbrainz.org"),
    dataDir: resolve(env("DATA_DIR") ?? "./data"),
    webDist: resolve(env("WEB_DIST") ?? new URL("../../web/dist", import.meta.url).pathname),
    trustedProxy: env("TRUST_PROXY") === "true",
    ...overrides,
  };
}
