import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/api.ts";
import type * as ApiModule from "../src/lib/api.ts";
import { clearYouTubeMusicStatus, ytm, useYouTubeMusicStatus } from "../src/lib/youtube-music.ts";

const request = vi.hoisted(() => vi.fn());

vi.mock("../src/lib/api.ts", async (importOriginal) => ({ ...await importOriginal<typeof ApiModule>(), request }));

beforeEach(() => {
  clearYouTubeMusicStatus();
  request.mockReset();
});

it("normalizes YouTube Music IDs and forwards search cancellation", async () => {
  request.mockResolvedValue({ songs: [] });

  await ytm.album("ytm:MPREb_album");

  expect(request).toHaveBeenLastCalledWith("/youtube-music/albums/MPREb_album", {});

  const searchController = new AbortController();

  await ytm.search("Neon Harbor", { kind: "songs", limit: 100, signal: searchController.signal });

  expect(request).toHaveBeenLastCalledWith("/youtube-music/search?q=Neon+Harbor&kind=songs&limit=100", { signal: searchController.signal });
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
