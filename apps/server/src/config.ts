import { resolve } from "node:path";

const env = process.env;
const trimSlash = (url: string) => url.replace(/\/+$/, "");

export type Config = {
  port: number;
  navidromeUrl: string;
  lidarr: { url: string; apiKey: string; qualityProfile: string | null; rootFolder: string | null } | null;
  spotify: { clientId: string; clientSecret: string } | null;
  publicUrl: string | null;
  dataDir: string;
  webDist: string;
};

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const lidarrUrl = env.LIDARR_URL;
  const lidarrKey = env.LIDARR_API_KEY;
  const spotifyId = env.SPOTIFY_CLIENT_ID;
  const spotifySecret = env.SPOTIFY_CLIENT_SECRET;
  return {
    port: Number(env.PORT ?? 4535),
    navidromeUrl: trimSlash(env.NAVIDROME_URL ?? "http://127.0.0.1:4533"),
    lidarr: lidarrUrl && lidarrKey
      ? { url: trimSlash(lidarrUrl), apiKey: lidarrKey, qualityProfile: env.LIDARR_QUALITY_PROFILE ?? null, rootFolder: env.LIDARR_ROOT_FOLDER ?? null }
      : null,
    spotify: spotifyId && spotifySecret ? { clientId: spotifyId, clientSecret: spotifySecret } : null,
    publicUrl: env.PUBLIC_URL ? trimSlash(env.PUBLIC_URL) : null,
    dataDir: resolve(env.DATA_DIR ?? "./data"),
    webDist: resolve(env.WEB_DIST ?? new URL("../../web/dist", import.meta.url).pathname),
    ...overrides,
  };
}
