import { isSpotify, rawId } from "./spotify.ts";

export const albumPath = (id: string) => (isSpotify(id) ? `/spotify/album/${rawId(id)}` : `/album/${id}`);
export const artistPath = (id: string) => (isSpotify(id) ? `/spotify/artist/${rawId(id)}` : `/artist/${id}`);
