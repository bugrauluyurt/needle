import { QueryClient } from "@tanstack/react-query";
import { SubsonicError } from "../lib/subsonic.ts";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof SubsonicError && err.code >= 40 && err.code < 80) && count < 2,
    },
  },
});
