import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { initializeViewport } from "./app/viewport.ts";
import { useUpdate } from "./state/update.ts";
import "./i18n/index.ts";
import "./styles/global.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/pages.css";
import "./styles/mobile.css";

initializeViewport();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

if ("serviceWorker" in navigator && import.meta.env.PROD && window.isSecureContext) {
  void import("workbox-window").then(({ Workbox }) => {
    const wb = new Workbox("/sw.js");
    wb.addEventListener("waiting", () =>
      useUpdate.setState({
        apply: () => {
          wb.addEventListener("controlling", () => location.reload());
          wb.messageSkipWaiting();
        },
      }),
    );
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void wb.update());
    void wb.register();
  });
}
