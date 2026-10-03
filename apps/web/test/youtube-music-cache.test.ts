import { beforeEach, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import type * as QueryModule from "@tanstack/react-query";
import type { Song, YouTubeMusicArtist, YouTubeMusicArtistDetail, YouTubeMusicPage } from "@needle/shared";
import { queryClient } from "../src/queries/client.ts";
import {
  clearYouTubeMusicCache,
  useToggleYouTubeMusicFollow,
  useToggleYouTubeMusicSave,
  ytmKeys,
} from "../src/features/youtube-music/hooks/useYouTubeMusic.ts";
import { ApiError } from "../src/lib/api.ts";
import { ytm } from "../src/features/youtube-music/api/client.ts";

const mutationHarness = vi.hoisted((): { options: unknown; client: QueryClient | null; user: string } => ({
  options: null,
  client: null,
  user: "listener-a",
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof QueryModule>()),
  useQueryClient: () => mutationHarness.client,
  useMutation: (options: unknown) => {
    mutationHarness.options = options;

    return { mutate: vi.fn() };
  },
}));

vi.mock("../src/state/session.ts", () => ({
  useSession: {
    getState: () => ({ credentials: { user: mutationHarness.user } }),
  },
}));
vi.mock("../src/state/ui.ts", () => ({ toast: vi.fn() }));

type RollbackContext<T> = {
  previousPages: [readonly unknown[], YouTubeMusicPage<T> | undefined][];
  generation: number;
  user: string;
  artistDetailKey?: readonly unknown[];
  previousArtist?: YouTubeMusicArtistDetail;
};

type LibraryMutationCallbacks<T> = {
  mutationFn: (variables: { item: T; on: boolean }) => Promise<void>;
  onMutate: (variables: { item: T; on: boolean }) => Promise<RollbackContext<T>>;
  onError: (error: Error, variables: { item: T; on: boolean }, context: RollbackContext<T> | undefined) => void;
};

const firstAccountSong: Song = {
  id: "ytm:video000001",
  title: "Account A song",
  source: "youtubeMusic",
};
const secondAccountSong: Song = {
  id: "ytm:video000002",
  title: "Account B song",
  source: "youtubeMusic",
};
const songPage = (songs: Song[]): YouTubeMusicPage<Song> => ({
  items: songs,
  total: songs.length,
  hasMore: false,
  limit: 100,
});

beforeEach(() => {
  mutationHarness.client = queryClient;
  mutationHarness.user = "listener-a";

  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });

  clearYouTubeMusicCache();
});

it("does not restore another Google account's library when an old mutation fails after reconnect", async () => {
  const likedKey = [...ytmKeys.liked, 100];

  queryClient.setQueryData(likedKey, songPage([firstAccountSong]));

  useToggleYouTubeMusicSave();

  const callbacks = mutationHarness.options as LibraryMutationCallbacks<Song>;
  const variables = { item: firstAccountSong, on: false };
  const context = await callbacks.onMutate(variables);

  clearYouTubeMusicCache();

  queryClient.setQueryData(likedKey, songPage([secondAccountSong]));

  callbacks.onError(new ApiError(409, "YouTube Music connection changed"), variables, context);

  expect(queryClient.getQueryData(likedKey)).toEqual(songPage([secondAccountSong]));
});

it("does not restore a signed-out Navidrome user's library", async () => {
  const likedKey = [...ytmKeys.liked, 100];

  queryClient.setQueryData(likedKey, songPage([firstAccountSong]));

  useToggleYouTubeMusicSave();

  const callbacks = mutationHarness.options as LibraryMutationCallbacks<Song>;
  const variables = { item: firstAccountSong, on: false };
  const context = await callbacks.onMutate(variables);

  queryClient.clear();

  mutationHarness.user = "listener-b";

  callbacks.onError(new Error("Request failed"), variables, context);

  expect(queryClient.getQueryData(likedKey)).toBeUndefined();
});

it("does not send an old mutation when reconnect happens during query cancellation", async () => {
  let releaseCancellation: () => void = () => undefined;
  let cancellationStarted: () => void = () => undefined;
  const cancellationPending = new Promise<void>((resolve) => {
    releaseCancellation = resolve;
  });
  const cancellationEntered = new Promise<void>((resolve) => {
    cancellationStarted = resolve;
  });
  const providerWrite = vi.spyOn(ytm, "like").mockResolvedValue();

  vi.spyOn(queryClient, "cancelQueries").mockImplementationOnce(async () => {
    cancellationStarted();

    await cancellationPending;
  });

  useToggleYouTubeMusicSave();

  const callbacks = mutationHarness.options as LibraryMutationCallbacks<Song>;
  const mutation = queryClient.getMutationCache().build(queryClient, callbacks);
  const mutationResult = mutation.execute({
    item: firstAccountSong,
    on: false,
  });

  await cancellationEntered;

  clearYouTubeMusicCache();
  releaseCancellation();

  await expect(mutationResult).rejects.toThrow("YouTube Music connection changed");

  expect(providerWrite).not.toHaveBeenCalled();
});

it("restores a failed mutation when the account remains the same", async () => {
  const likedKey = [...ytmKeys.liked, 100];

  queryClient.setQueryData(likedKey, songPage([firstAccountSong]));

  useToggleYouTubeMusicSave();

  const callbacks = mutationHarness.options as LibraryMutationCallbacks<Song>;
  const variables = { item: firstAccountSong, on: false };
  const context = await callbacks.onMutate(variables);

  expect(queryClient.getQueryData<YouTubeMusicPage<Song>>(likedKey)?.items).toEqual([]);

  callbacks.onError(new Error("Request failed"), variables, context);

  expect(queryClient.getQueryData(likedKey)).toEqual(songPage([firstAccountSong]));
});

it("updates and restores authoritative artist membership beyond the loaded library page", async () => {
  const artist: YouTubeMusicArtist = {
    id: "ytm:UC_artist101",
    name: "Artist 101",
    images: [],
    subscribed: true,
  };
  const artistDetail: YouTubeMusicArtistDetail = {
    artist,
    songs: [],
    albums: [],
    singles: [],
    hasMoreSongs: false,
    hasMoreAlbums: false,
    hasMoreSingles: false,
  };
  const artistDetailKey = ytmKeys.artist(artist.id);

  queryClient.setQueryData(artistDetailKey, artistDetail);
  queryClient.setQueryData([...ytmKeys.artists, 100], {
    items: [],
    total: 101,
    hasMore: true,
    limit: 100,
  });

  useToggleYouTubeMusicFollow();

  const callbacks = mutationHarness.options as LibraryMutationCallbacks<YouTubeMusicArtist>;
  const variables = { item: artist, on: false };
  const context = await callbacks.onMutate(variables);

  expect(queryClient.getQueryData<YouTubeMusicArtistDetail>(artistDetailKey)?.artist.subscribed).toBe(false);

  callbacks.onError(new Error("Request failed"), variables, context);

  expect(queryClient.getQueryData<YouTubeMusicArtistDetail>(artistDetailKey)?.artist.subscribed).toBe(true);
});
