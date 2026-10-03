import type { Context, Hono } from "hono";
import type { Auth } from "../navidrome.ts";
import type { YouTubeMusic } from "../youtube-music.ts";

export type AppEnv = { Variables: { auth: Auth; youtubeMusic: YouTubeMusic } };
export type App = Hono<AppEnv>;
export type AppContext = Context<AppEnv>;
