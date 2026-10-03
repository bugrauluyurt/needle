import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { RouterProvider } from "react-router";
import { useDetails } from "../components/songDetailsStore.ts";
import { Login } from "../pages/Login.tsx";
import { queryClient } from "../queries/client.ts";
import { useSession } from "../state/session.ts";
import { useSettings } from "../state/settings.ts";
import { changeLanguage } from "../i18n/index.ts";
import { useAppRuntime } from "./hooks/useAppRuntime.ts";
import { router } from "./router.tsx";

const SongDetailsDialog = lazy(() => import("../components/SongDetails.tsx"));

export function App() {
  const signedIn = useSession((sessionState) => Boolean(sessionState.credentials));
  const detailsOpen = useDetails((detailsState) => Boolean(detailsState.song));
  const selectedLanguage = useSettings((settingsState) => settingsState.language);
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage;

  useAppRuntime(signedIn);

  useEffect(() => {
    if (i18n.resolvedLanguage !== selectedLanguage) void changeLanguage(selectedLanguage);
  }, [i18n, selectedLanguage]);

  return (
    <QueryClientProvider client={queryClient}>
      {signedIn ? <RouterProvider key={language} router={router} /> : <Login key={language} />}
      {detailsOpen ? (
        <Suspense key={language} fallback={null}>
          <SongDetailsDialog />
        </Suspense>
      ) : null}
    </QueryClientProvider>
  );
}
