import type { Song } from "@needle/shared";
import type { QueryClient } from "@tanstack/react-query";
import type * as QueryModule from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { SpArtist, SpPlaylist } from "../src/features/spotify/api/client.ts";
import { sp } from "../src/features/spotify/api/client.ts";
import {
  clearSpotifyCache,
  spKeys,
  useSpotifyPlaylistEdits,
  useToggleSpotifyFollow,
  useToggleSpotifySave,
} from "../src/features/spotify/hooks/useSpotify.ts";
import { queryClient } from "../src/queries/client.ts";

const mutationHarness = vi.hoisted(
  (): {
    options: unknown;
    client: QueryClient | null;
    user: string;
    toast: ReturnType<typeof vi.fn>;
    storageWrite: ReturnType<typeof vi.fn>;
  } => ({
    options: null,
    client: null,
    user: "Alice",
    toast: vi.fn(),
    storageWrite: vi.fn(),
  }),
);

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof QueryModule>()),
  useQueryClient: () => mutationHarness.client,
  useMutation: (options: unknown) => {
    mutationHarness.options = options;

    return { mutate: vi.fn(), mutateAsync: vi.fn() };
  },
}));

vi.mock("../src/state/session.ts", () => ({
  credentials: () => ({ user: mutationHarness.user }),
  useSession: {
    getState: () => ({ credentials: { user: mutationHarness.user } }),
  },
}));

vi.mock("../src/state/ui.ts", () => ({ toast: mutationHarness.toast }));

type Deferred<Value> = {
  promise: Promise<Value>;
  reject: (reason: Error) => void;
  resolve: (value: Value) => void;
};

type ToggleContext<Item> = {
  previous: Item[] | undefined;
  generation: number;
  user: string;
  queryKey: readonly unknown[];
};
type ToggleCallbacks<Variables, Item> = {
  mutationFn: (variables: Variables) => Promise<void>;
  onMutate: (variables: Variables) => Promise<ToggleContext<Item>>;
  onSuccess: (data: void, variables: Variables, context: ToggleContext<Item>) => void;
  onError: (error: Error, variables: Variables, context: ToggleContext<Item>) => void;
};

type FollowVariables = { artist: SpArtist; on: boolean };
type SaveVariables = { song: Song; on: boolean };

function deferred<Value>(): Deferred<Value> {
  let rejectPromise: (reason: Error) => void = () => undefined;
  let resolvePromise: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });

  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

const aliceArtist: SpArtist = { id: "alice-artist", name: "Alice artist", images: [] };
const bobArtist: SpArtist = { id: "bob-artist", name: "Bob artist", images: [] };
const aliceSong: Song = { id: "sp:alice-song", title: "Alice song", source: "spotify", uri: "spotify:track:alice" };
const bobSong: Song = { id: "sp:bob-song", title: "Bob song", source: "spotify", uri: "spotify:track:bob" };
const playlist: SpPlaylist = {
  id: "playlist-1",
  name: "Playlist",
  owner: { id: "Alice" },
  collaborative: false,
};

beforeEach(() => {
  mutationHarness.client = queryClient;
  mutationHarness.user = "Alice";
  mutationHarness.toast.mockReset();
  mutationHarness.storageWrite.mockReset();

  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: mutationHarness.storageWrite,
    removeItem: vi.fn(),
  });

  queryClient.clear();
  clearSpotifyCache();
});

it("does not restore followed artists or notify Bob when Alice's request fails", async () => {
  const aliceFollowedKey = spKeys.followed;
  queryClient.setQueryData(aliceFollowedKey, [aliceArtist]);
  const providerWrite = deferred<void>();
  vi.spyOn(sp, "unsave").mockReturnValue(providerWrite.promise);

  useToggleSpotifyFollow();

  const callbacks = mutationHarness.options as ToggleCallbacks<FollowVariables, SpArtist>;
  const variables = { artist: aliceArtist, on: false };
  const context = await callbacks.onMutate(variables);
  const mutationResult = callbacks.mutationFn(variables);

  clearSpotifyCache();
  mutationHarness.user = "Bob";
  const bobFollowedKey = spKeys.followed;
  queryClient.setQueryData(bobFollowedKey, [bobArtist]);
  const requestError = new Error("Request failed");
  providerWrite.reject(requestError);

  await expect(mutationResult).rejects.toThrow("Request failed");
  callbacks.onError(requestError, variables, context);

  expect(queryClient.getQueryData(bobFollowedKey)).toEqual([bobArtist]);
  expect(mutationHarness.toast).not.toHaveBeenCalled();
});

it("does not notify Bob when Alice's follow request succeeds late", async () => {
  const providerWrite = deferred<void>();
  vi.spyOn(sp, "save").mockReturnValue(providerWrite.promise);

  useToggleSpotifyFollow();

  const callbacks = mutationHarness.options as ToggleCallbacks<FollowVariables, SpArtist>;
  const variables = { artist: aliceArtist, on: true };
  const context = await callbacks.onMutate(variables);
  const mutationResult = callbacks.mutationFn(variables);

  clearSpotifyCache();
  mutationHarness.user = "Bob";
  providerWrite.resolve(undefined);

  await mutationResult;
  callbacks.onSuccess(undefined, variables, context);

  expect(mutationHarness.toast).not.toHaveBeenCalled();
});

it("does not send Alice's follow mutation after the account changes", async () => {
  const providerWrite = vi.spyOn(sp, "save").mockResolvedValue();

  useToggleSpotifyFollow();

  const callbacks = mutationHarness.options as ToggleCallbacks<FollowVariables, SpArtist>;
  const variables = { artist: aliceArtist, on: true };
  await callbacks.onMutate(variables);

  clearSpotifyCache();
  mutationHarness.user = "Bob";

  await expect(callbacks.mutationFn(variables)).rejects.toThrow("Account changed");
  expect(providerWrite).not.toHaveBeenCalled();
});

it("does not restore liked songs or notify Bob when Alice's request fails", async () => {
  const aliceLikedKey = spKeys.liked;
  queryClient.setQueryData(aliceLikedKey, [aliceSong]);
  const providerWrite = deferred<void>();
  vi.spyOn(sp, "unsave").mockReturnValue(providerWrite.promise);

  useToggleSpotifySave();

  const callbacks = mutationHarness.options as ToggleCallbacks<SaveVariables, Song>;
  const variables = { song: aliceSong, on: false };
  const context = await callbacks.onMutate(variables);
  const mutationResult = callbacks.mutationFn(variables);

  clearSpotifyCache();
  mutationHarness.user = "Bob";
  const bobLikedKey = spKeys.liked;
  queryClient.setQueryData(bobLikedKey, [bobSong]);
  const requestError = new Error("Request failed");
  providerWrite.reject(requestError);

  await expect(mutationResult).rejects.toThrow("Request failed");
  callbacks.onError(requestError, variables, context);

  expect(queryClient.getQueryData(bobLikedKey)).toEqual([bobSong]);
  expect(mutationHarness.toast).not.toHaveBeenCalled();
});

it("stops a late playlist creation before writing songs for Bob", async () => {
  const playlistCreation = deferred<SpPlaylist>();
  vi.spyOn(sp, "createPlaylist").mockReturnValue(playlistCreation.promise);
  const addSongs = vi.spyOn(sp, "addToPlaylist").mockResolvedValue({ snapshot_id: "snapshot-1" });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
  const edits = useSpotifyPlaylistEdits();

  const createResult = edits.create("Playlist", [aliceSong]);

  clearSpotifyCache();
  mutationHarness.user = "Bob";
  playlistCreation.resolve(playlist);

  await expect(createResult).resolves.toBeNull();
  expect(addSongs).not.toHaveBeenCalled();
  expect(invalidateQueries).not.toHaveBeenCalled();
  expect(mutationHarness.toast).not.toHaveBeenCalled();
});

it("does not restore a reordered playlist or notify Bob after Alice's request fails", async () => {
  const alicePlaylistKey = spKeys.playlist(playlist.id);
  queryClient.setQueryData(alicePlaylistKey, { meta: playlist, songs: [aliceSong, bobSong] });
  const providerWrite = deferred<{ snapshot_id: string }>();
  vi.spyOn(sp, "reorderPlaylist").mockReturnValue(providerWrite.promise);
  const edits = useSpotifyPlaylistEdits();

  const reorderResult = edits.reorder(playlist.id, 0, 1);

  clearSpotifyCache();
  mutationHarness.user = "Bob";
  const bobPlaylistKey = spKeys.playlist(playlist.id);
  queryClient.setQueryData(bobPlaylistKey, { meta: playlist, songs: [bobSong] });
  providerWrite.reject(new Error("Request failed"));

  await reorderResult;

  expect(queryClient.getQueryData(bobPlaylistKey)).toEqual({ meta: playlist, songs: [bobSong] });
  expect(mutationHarness.toast).not.toHaveBeenCalled();
});

it("restores same-account follow, like and reorder failures", async () => {
  const followedKey = spKeys.followed;
  const likedKey = spKeys.liked;
  const playlistKey = spKeys.playlist(playlist.id);
  queryClient.setQueryData(followedKey, [aliceArtist]);
  queryClient.setQueryData(likedKey, [aliceSong]);
  queryClient.setQueryData(playlistKey, { meta: playlist, songs: [aliceSong, bobSong] });

  useToggleSpotifyFollow();
  const followCallbacks = mutationHarness.options as ToggleCallbacks<FollowVariables, SpArtist>;
  const followVariables = { artist: aliceArtist, on: false };
  const followContext = await followCallbacks.onMutate(followVariables);
  followCallbacks.onError(new Error("Request failed"), followVariables, followContext);

  useToggleSpotifySave();
  const saveCallbacks = mutationHarness.options as ToggleCallbacks<SaveVariables, Song>;
  const saveVariables = { song: aliceSong, on: false };
  const saveContext = await saveCallbacks.onMutate(saveVariables);
  saveCallbacks.onError(new Error("Request failed"), saveVariables, saveContext);

  vi.spyOn(sp, "reorderPlaylist").mockRejectedValue(new Error("Request failed"));
  await useSpotifyPlaylistEdits().reorder(playlist.id, 0, 1);

  expect(queryClient.getQueryData(followedKey)).toEqual([aliceArtist]);
  expect(queryClient.getQueryData(likedKey)).toEqual([aliceSong]);
  expect(queryClient.getQueryData(playlistKey)).toEqual({ meta: playlist, songs: [aliceSong, bobSong] });
  expect(mutationHarness.toast).toHaveBeenCalledTimes(3);
});

it("does not persist an Alice query update inside Bob's cache namespace", () => {
  const aliceLikedKey = spKeys.liked;

  mutationHarness.user = "Bob";
  mutationHarness.storageWrite.mockClear();
  queryClient.setQueryData(aliceLikedKey, [aliceSong]);

  expect(mutationHarness.storageWrite).not.toHaveBeenCalled();
});
