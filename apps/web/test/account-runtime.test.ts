import { beforeEach, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  activateSpotify: vi.fn(),
  clearQueries: vi.fn(),
  clearSpotify: vi.fn(),
  clearYouTubeMusic: vi.fn(),
  registerReset: vi.fn(),
  resetDetails: vi.fn(),
  resetOffline: vi.fn(),
  resetPlayer: vi.fn(),
  stopRemote: vi.fn(),
}));

vi.mock("../src/offline/store.ts", () => ({
  loadOffline: vi.fn(),
  resetOfflineAccount: runtimeMocks.resetOffline,
}));

vi.mock("../src/player/controller.ts", () => ({
  resetPlayerAccount: runtimeMocks.resetPlayer,
  startPlayer: vi.fn(),
}));

vi.mock("../src/queries/client.ts", () => ({
  queryClient: { clear: runtimeMocks.clearQueries },
}));

vi.mock("../src/queries/hooks.ts", () => ({ prefetchStart: vi.fn() }));

vi.mock("../src/features/spotify/hooks/useSpotify.ts", () => ({
  clearSpotifyCache: runtimeMocks.clearSpotify,
}));

vi.mock("../src/features/spotify/api/client.ts", () => ({
  activateSpotifyAccount: runtimeMocks.activateSpotify,
}));

vi.mock("../src/features/youtube-music/hooks/useYouTubeMusic.ts", () => ({
  clearYouTubeMusicCache: runtimeMocks.clearYouTubeMusic,
}));

vi.mock("../src/features/remote/client.ts", () => ({
  startRemote: vi.fn(),
  stopRemote: runtimeMocks.stopRemote,
}));

vi.mock("../src/components/songDetailsStore.ts", () => ({
  useDetails: { setState: runtimeMocks.resetDetails },
}));

vi.mock("../src/state/accountLifecycle.ts", () => ({
  registerAccountResetHandler: runtimeMocks.registerReset,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

it("clears every account-bound runtime before another account starts", async () => {
  const { resetAccountRuntime } = await import("../src/app/hooks/useAppRuntime.ts");

  resetAccountRuntime();

  expect(runtimeMocks.stopRemote).toHaveBeenCalledOnce();
  expect(runtimeMocks.clearQueries).toHaveBeenCalledOnce();
  expect(runtimeMocks.clearSpotify).toHaveBeenCalledOnce();
  expect(runtimeMocks.clearYouTubeMusic).toHaveBeenCalledOnce();
  expect(runtimeMocks.resetOffline).toHaveBeenCalledOnce();
  expect(runtimeMocks.resetPlayer).toHaveBeenCalledOnce();
  expect(runtimeMocks.resetDetails).toHaveBeenCalledWith({ song: null });
});
