import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/api.ts";
import type * as ApiModule from "../src/lib/api.ts";
import { clearYouTubeMusicStatus, ytm, useYouTubeMusicStatus } from "../src/features/youtube-music/api/client.ts";
import { useSession } from "../src/state/session.ts";

const request = vi.hoisted(() => vi.fn());

vi.mock("../src/lib/api.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  request,
}));

beforeEach(() => {
  clearYouTubeMusicStatus();
  request.mockReset();
  useSession.setState({ credentials: { user: "Alice", token: "alice-token", salt: "alice-salt" } });
});

it("normalizes YouTube Music IDs and forwards search cancellation", async () => {
  request.mockResolvedValue({ songs: [] });

  await ytm.album("ytm:MPREb_album");

  expect(request).toHaveBeenLastCalledWith("/youtube-music/albums/MPREb_album", {});

  const searchController = new AbortController();

  await ytm.search("Neon Harbor", {
    kind: "songs",
    limit: 100,
    signal: searchController.signal,
  });

  expect(request).toHaveBeenLastCalledWith("/youtube-music/search?q=Neon+Harbor&kind=songs&limit=100", {
    signal: searchController.signal,
  });
});

it("pauses metadata requests after a quota response without calling upstream again", async () => {
  request.mockRejectedValueOnce(new ApiError(429, "Please wait"));

  await expect(ytm.liked()).rejects.toThrow("Please wait");

  expect(useYouTubeMusicStatus.getState().blocked).toBe(true);

  await expect(ytm.search("Neon")).rejects.toThrow("YouTube Music requests are paused");

  expect(request).toHaveBeenCalledTimes(1);
});

it("allows disconnect and login polling while metadata requests are paused", async () => {
  request.mockRejectedValueOnce(new ApiError(429, "Please wait"));

  await expect(ytm.liked()).rejects.toThrow();

  request.mockResolvedValue({ state: "pending" });

  await ytm.pollLogin();
  await ytm.disconnect();

  expect(request).toHaveBeenCalledTimes(3);
});

it("does not let Alice's late quota response pause Bob", async () => {
  let rejectAliceRequest: (requestError: Error) => void = () => undefined;
  request.mockImplementationOnce(
    () =>
      new Promise<never>((_resolve, reject) => {
        rejectAliceRequest = reject;
      }),
  );

  const aliceRequest = ytm.liked();

  clearYouTubeMusicStatus();
  useSession.setState({ credentials: { user: "Bob", token: "bob-token", salt: "bob-salt" } });
  rejectAliceRequest(new ApiError(429, "Please wait"));

  await expect(aliceRequest).rejects.toThrow("Please wait");
  expect(useYouTubeMusicStatus.getState()).toEqual({ blocked: false, until: 0 });
});
