import { useEffect } from "react";
import { loadOffline } from "../../offline/store.ts";
import { startPlayer } from "../../player/controller.ts";
import { queryClient } from "../../queries/client.ts";
import { prefetchStart } from "../../queries/hooks.ts";
import { clearSpotifyCache } from "../../features/spotify/hooks/useSpotify.ts";
import { clearYouTubeMusicCache } from "../../features/youtube-music/hooks/useYouTubeMusic.ts";
import { startRemote, stopRemote } from "../../features/remote/client.ts";

export function useAppRuntime(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) {
      stopRemote();
      queryClient.clear();
      clearSpotifyCache();
      clearYouTubeMusicCache();

      return;
    }

    prefetchStart(queryClient);
    startPlayer();
    startRemote();
    void loadOffline();
  }, [signedIn]);
}
