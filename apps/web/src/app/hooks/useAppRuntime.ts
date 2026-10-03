import { useEffect } from "react";
import { loadOffline, resetOfflineAccount } from "../../offline/store.ts";
import { resetPlayerAccount, startPlayer } from "../../player/controller.ts";
import { queryClient } from "../../queries/client.ts";
import { prefetchStart } from "../../queries/hooks.ts";
import { clearSpotifyCache } from "../../features/spotify/hooks/useSpotify.ts";
import { activateSpotifyAccount } from "../../features/spotify/api/client.ts";
import { clearYouTubeMusicCache } from "../../features/youtube-music/hooks/useYouTubeMusic.ts";
import { startRemote, stopRemote } from "../../features/remote/client.ts";
import { useDetails } from "../../components/songDetailsStore.ts";
import { registerAccountResetHandler } from "../../state/accountLifecycle.ts";
import { clearCredentialedCoverCache } from "../../state/credentialedCaches.ts";

export function resetAccountRuntime(): void {
  clearCredentialedCoverCache();
  stopRemote();
  queryClient.clear();
  clearSpotifyCache();
  clearYouTubeMusicCache();
  resetOfflineAccount();
  resetPlayerAccount();
  useDetails.setState({ song: null });
}

registerAccountResetHandler(resetAccountRuntime);

export function startAccountRuntime(accountUser: string | null): void {
  if (!accountUser) {
    clearCredentialedCoverCache();

    return;
  }

  activateSpotifyAccount(accountUser);
  prefetchStart(queryClient);
  startPlayer();
  startRemote();
  void loadOffline();
}

export function useAppRuntime(accountUser: string | null) {
  useEffect(() => startAccountRuntime(accountUser), [accountUser]);
}
