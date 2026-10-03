import { useQuery } from "@tanstack/react-query";
import { HOUR_MS } from "@needle/shared";
import { api } from "../../../lib/api.ts";
import { sub } from "../../../lib/subsonic.ts";
import { keys } from "../../../queries/keys.ts";
import { useSession } from "../../../state/session.ts";

export const useStorageEstimate = () =>
  useQuery({
    queryKey: keys.storage,
    queryFn: async () => (await navigator.storage?.estimate?.()) ?? null,
    staleTime: 60_000,
  });

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: api.me, staleTime: HOUR_MS });

export const usePeople = (enabled: boolean) =>
  useQuery({ queryKey: keys.people, queryFn: api.people, enabled });

export const useCapabilities = () =>
  useQuery({
    queryKey: keys.capabilities,
    queryFn: api.capabilities,
    staleTime: 5 * 60_000,
  });

export function useCanRequest(): boolean {
  const capabilities = useCapabilities().data;

  return capabilities ? capabilities.lidarr || capabilities.songs : false;
}

export function useIsAdmin(): boolean {
  const user = useSession(
    (sessionState) => sessionState.credentials?.user ?? "",
  );

  return (
    useQuery({
      queryKey: keys.user(user),
      queryFn: () => sub.user(user),
      enabled: Boolean(user),
      staleTime: HOUR_MS,
    }).data?.adminRole ?? false
  );
}
