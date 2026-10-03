import { ApiErrorCode } from "@needle/shared";
import { createMiddleware } from "hono/factory";
import type { Lidarr } from "../lidarr.ts";
import type { Auth, Navidrome } from "../navidrome.ts";
import type { People, Permission } from "../people.ts";
import type { SongDownloads } from "../soulseek.ts";
import type { Spotify } from "../spotify.ts";
import type { AppEnv } from "./context.ts";
import { appError } from "./errors.ts";

const ADMIN_TTL = 10 * 60_000;

type AuthorizationDependencies = {
  lidarr: Lidarr | null;
  navidrome: Navidrome;
  people: People;
  songs: SongDownloads | null;
  spotify: Spotify | null;
};

export function createAuthorization({ lidarr, navidrome, people, songs, spotify }: AuthorizationDependencies) {
  const admins = new Map<string, { admin: boolean; until: number }>();

  const isAdmin = async (auth: Auth) => {
    const cachedAdmin = admins.get(auth.user);

    if (cachedAdmin && cachedAdmin.until > Date.now()) return cachedAdmin.admin;

    const userResponse = await navidrome.call<{
      user: { adminRole?: boolean };
    }>(auth, "getUser", {
      username: auth.user,
    });
    const admin = Boolean(userResponse.user.adminRole);

    admins.set(auth.user, { admin, until: Date.now() + ADMIN_TTL });
    people.seen(auth.user, admin);

    return admin;
  };

  const can = async (auth: Auth, permission: Permission) => people.allowed(auth.user, await isAdmin(auth), permission);
  const authorize = async (auth: Auth, permission: Permission, message: string) => {
    if (!(await can(auth, permission))) throw appError(403, ApiErrorCode.FORBIDDEN, message);
  };

  const getLidarr = () => {
    if (!lidarr) {
      throw appError(404, ApiErrorCode.INTEGRATION_NOT_CONFIGURED, "Lidarr isn't set up on the Needle server");
    }

    return lidarr;
  };

  const getSongs = () => {
    if (!songs) {
      throw appError(404, ApiErrorCode.INTEGRATION_NOT_CONFIGURED, "slskd isn't set up on the Needle server");
    }

    return songs;
  };

  const getSpotify = () => {
    if (!spotify) {
      throw appError(
        404,
        ApiErrorCode.INTEGRATION_NOT_CONFIGURED,
        "Add SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and PUBLIC_URL to the Needle server",
      );
    }

    return spotify;
  };

  const requireAdmin = (message: string) =>
    createMiddleware<AppEnv>(async (context, next) => {
      if (!(await isAdmin(context.get("auth")))) {
        throw appError(403, ApiErrorCode.FORBIDDEN, message);
      }

      await next();
    });

  const requirePermission = (permission: Permission, message: string) =>
    createMiddleware<AppEnv>(async (context, next) => {
      await authorize(context.get("auth"), permission, message);

      await next();
    });

  const requireLidarr = createMiddleware<AppEnv>(async (context, next) => {
    context.set("lidarr", getLidarr());

    await next();
  });

  const requireSongs = createMiddleware<AppEnv>(async (context, next) => {
    context.set("songs", getSongs());

    await next();
  });

  const requireSpotify = createMiddleware<AppEnv>(async (context, next) => {
    context.set("spotify", getSpotify());

    await next();
  });

  return {
    authorize,
    can,
    getLidarr,
    getSongs,
    getSpotify,
    isAdmin,
    requireAdmin,
    requireLidarr,
    requirePermission,
    requireSongs,
    requireSpotify,
  };
}

export type Authorization = ReturnType<typeof createAuthorization>;
