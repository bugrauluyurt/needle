import type { PlaylistWithSongs, Song } from "@needle/shared";
import type { QueryClient } from "@tanstack/react-query";
import type * as QueryModule from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { queryClient } from "../src/queries/client.ts";
import { useReorderPlaylist, useToggleStar } from "../src/queries/hooks.ts";
import { keys } from "../src/queries/keys.ts";
import { resetAccountState } from "../src/state/accountLifecycle.ts";
import { sub } from "../src/lib/subsonic.ts";

const mutationHarness = vi.hoisted(
  (): {
    options: unknown;
    client: QueryClient | null;
    user: string;
    toast: ReturnType<typeof vi.fn>;
  } => ({
    options: null,
    client: null,
    user: "Alice",
    toast: vi.fn(),
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
  useSession: Object.assign(
    (selector: (state: { credentials: { user: string } }) => unknown) =>
      selector({ credentials: { user: mutationHarness.user } }),
    {
      getState: () => ({ credentials: { user: mutationHarness.user } }),
    },
  ),
}));

vi.mock("../src/state/ui.ts", () => ({ toast: mutationHarness.toast }));

type AccountMutationContext<Value> = {
  previous: Value | undefined;
  generation: number;
  user: string;
};

type StarVariables = { kind: "song"; item: Song; on: boolean };
type StarCallbacks = {
  mutationFn: (variables: StarVariables) => Promise<void>;
  onMutate: (variables: StarVariables) => Promise<AccountMutationContext<{ song?: Song[] }>>;
  onError: (
    error: Error,
    variables: StarVariables,
    context: AccountMutationContext<{ song?: Song[] }> | undefined,
  ) => void;
  onSettled: (
    data: void | undefined,
    error: Error | null,
    variables: StarVariables,
    context: AccountMutationContext<{ song?: Song[] }> | undefined,
  ) => void;
};

type ReorderVariables = { id: string; songIds: string[] };
type ReorderCallbacks = {
  onMutate: (variables: ReorderVariables) => AccountMutationContext<PlaylistWithSongs>;
  onError: (
    error: Error,
    variables: ReorderVariables,
    context: AccountMutationContext<PlaylistWithSongs> | undefined,
  ) => void;
  onSettled: (
    data: void | undefined,
    error: Error | null,
    variables: ReorderVariables,
    context: AccountMutationContext<PlaylistWithSongs> | undefined,
  ) => void;
};

const aliceSong: Song = { id: "alice-song", title: "Alice song" };
const secondAliceSong: Song = { id: "alice-song-2", title: "Second Alice song" };
const bobSong: Song = { id: "bob-song", title: "Bob song" };
const playlist = (songs: Song[]): PlaylistWithSongs => ({
  id: "playlist-1",
  name: "Playlist",
  songCount: songs.length,
  duration: 0,
  entry: songs,
});

beforeEach(() => {
  mutationHarness.client = queryClient;
  mutationHarness.user = "Alice";
  mutationHarness.toast.mockReset();
  queryClient.clear();
  resetAccountState();
});

it("does not restore Alice's starred library or invalidate Bob's cache after switching accounts", async () => {
  queryClient.setQueryData(keys.starred, { song: [aliceSong] });
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

  useToggleStar();

  const callbacks = mutationHarness.options as StarCallbacks;
  const variables: StarVariables = { kind: "song", item: aliceSong, on: false };
  const context = await callbacks.onMutate(variables);

  resetAccountState();
  mutationHarness.user = "Bob";
  queryClient.setQueryData(keys.starred, { song: [bobSong] });
  callbacks.onError(new Error("Request failed"), variables, context);
  callbacks.onSettled(undefined, new Error("Request failed"), variables, context);

  expect(queryClient.getQueryData(keys.starred)).toEqual({ song: [bobSong] });
  expect(invalidateQueries).not.toHaveBeenCalled();
  expect(mutationHarness.toast).not.toHaveBeenCalled();
});

it("does not send Alice's star mutation after the account changes", async () => {
  const providerWrite = vi.spyOn(sub, "star").mockResolvedValue(undefined);

  useToggleStar();

  const callbacks = mutationHarness.options as StarCallbacks;
  const variables: StarVariables = { kind: "song", item: aliceSong, on: true };
  await callbacks.onMutate(variables);

  resetAccountState();
  mutationHarness.user = "Bob";

  await expect(callbacks.mutationFn(variables)).rejects.toThrow("Account changed");
  expect(providerWrite).not.toHaveBeenCalled();
});

it("does not restore Alice's playlist order or invalidate Bob's cache after switching accounts", () => {
  queryClient.setQueryData(keys.playlist("playlist-1"), playlist([aliceSong, secondAliceSong]));
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

  useReorderPlaylist();

  const callbacks = mutationHarness.options as ReorderCallbacks;
  const variables = { id: "playlist-1", songIds: [secondAliceSong.id, aliceSong.id] };
  const context = callbacks.onMutate(variables);

  resetAccountState();
  mutationHarness.user = "Bob";
  queryClient.setQueryData(keys.playlist("playlist-1"), playlist([bobSong]));
  callbacks.onError(new Error("Request failed"), variables, context);
  callbacks.onSettled(undefined, new Error("Request failed"), variables, context);

  expect(queryClient.getQueryData(keys.playlist("playlist-1"))).toEqual(playlist([bobSong]));
  expect(invalidateQueries).not.toHaveBeenCalled();
  expect(mutationHarness.toast).not.toHaveBeenCalled();
});

it("restores and refreshes failed optimistic updates while the account remains active", async () => {
  queryClient.setQueryData(keys.starred, { song: [aliceSong] });
  queryClient.setQueryData(keys.playlist("playlist-1"), playlist([aliceSong, secondAliceSong]));
  const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

  useToggleStar();
  const starCallbacks = mutationHarness.options as StarCallbacks;
  const starVariables: StarVariables = { kind: "song", item: aliceSong, on: false };
  const starContext = await starCallbacks.onMutate(starVariables);
  starCallbacks.onError(new Error("Request failed"), starVariables, starContext);
  starCallbacks.onSettled(undefined, new Error("Request failed"), starVariables, starContext);

  useReorderPlaylist();
  const reorderCallbacks = mutationHarness.options as ReorderCallbacks;
  const reorderVariables = { id: "playlist-1", songIds: [secondAliceSong.id, aliceSong.id] };
  const reorderContext = reorderCallbacks.onMutate(reorderVariables);
  reorderCallbacks.onError(new Error("Request failed"), reorderVariables, reorderContext);
  reorderCallbacks.onSettled(undefined, new Error("Request failed"), reorderVariables, reorderContext);

  expect(queryClient.getQueryData(keys.starred)).toEqual({ song: [aliceSong] });
  expect(queryClient.getQueryData(keys.playlist("playlist-1"))).toEqual(playlist([aliceSong, secondAliceSong]));
  expect(invalidateQueries).toHaveBeenCalledTimes(2);
  expect(mutationHarness.toast).toHaveBeenCalledTimes(2);
});
