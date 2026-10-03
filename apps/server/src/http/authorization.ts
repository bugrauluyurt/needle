import type { Lidarr } from "../lidarr.ts";
import type { Auth, Navidrome } from "../navidrome.ts";
import type { People, Permission } from "../people.ts";
import type { SongDownloads } from "../soulseek.ts";
import type { Spotify } from "../spotify.ts";
import type { AppContext } from "./context.ts";

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

    const userResponse = await navidrome.call<{ user: { adminRole?: boolean } }>(auth, "getUser", {
      username: auth.user,
    });
    const admin = Boolean(userResponse.user.adminRole);

    admins.set(auth.user, { admin, until: Date.now() + ADMIN_TTL });
    people.seen(auth.user, admin);

    return admin;
  };

  const can = async (auth: Auth, permission: Permission) => people.allowed(auth.user, await isAdmin(auth), permission);
  const forbiddenResponse = (context: AppContext, error: string) => context.json({ error }, 403);

  const getLidarrAccess = async (context: AppContext) => {
    if (!lidarr) return { error: context.json({ error: "Lidarr isn't set up on the Needle server" }, 404) };
    if (!(await can(context.get("auth"), "request"))) {
      return { error: forbiddenResponse(context, "Ask an admin to let you request music") };
    }

    return { lidarr };
  };

  const getLidarrAdminAccess = async (context: AppContext) => {
    if (!lidarr) return { error: context.json({ error: "Lidarr isn't set up on the Needle server" }, 404) };
    if (!(await isAdmin(context.get("auth")))) {
      return { error: forbiddenResponse(context, "Only Navidrome admins can manage Lidarr's downloads") };
    }

    return { lidarr };
  };

  const getSongAccess = async (context: AppContext) => {
    if (!songs) return { error: context.json({ error: "slskd isn't set up on the Needle server" }, 404) };
    if (!(await can(context.get("auth"), "request"))) {
      return { error: forbiddenResponse(context, "Ask an admin to let you request music") };
    }

    return { songs };
  };

  const getSpotifyAccess = async (context: AppContext) => {
    if (!spotify) {
      return {
        error: context.json(
          { error: "Add SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and PUBLIC_URL to the Needle server" },
          404,
        ),
      };
    }

    if (!(await can(context.get("auth"), "spotify"))) {
      return { error: forbiddenResponse(context, "Ask an admin to let you use Spotify in Needle") };
    }

    return { spotify };
  };

  return {
    can,
    forbiddenResponse,
    getLidarrAccess,
    getLidarrAdminAccess,
    getSongAccess,
    getSpotifyAccess,
    isAdmin,
  };
}

export type Authorization = ReturnType<typeof createAuthorization>;
