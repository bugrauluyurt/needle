import type { Context, Hono } from "hono";
import type { Lidarr } from "../lidarr.ts";
import type { Auth } from "../navidrome.ts";
import type { SongDownloads } from "../soulseek.ts";
import type { Spotify } from "../spotify.ts";
import type { YouTubeMusic } from "../youtube-music.ts";

export type AppEnv = {
  Variables: {
    auth: Auth;
    lidarr: Lidarr;
    requestId: string;
    songs: SongDownloads;
    spotify: Spotify;
    youtubeMusic: YouTubeMusic;
  };
};
export type App = Hono<AppEnv>;
export type AppContext = Context<AppEnv>;
