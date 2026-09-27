import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { usePlayer } from "./player/store.ts";
import "./styles/global.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/pages.css";
import "./styles/mobile.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

for (const gesture of ["gesturestart", "gesturechange"]) document.addEventListener(gesture, (e) => e.preventDefault(), { passive: false });

if ("serviceWorker" in navigator && import.meta.env.PROD && window.isSecureContext) {
  void import("workbox-window").then(({ Workbox }) => {
    const wb = new Workbox("/sw.js");
    const reloadWhenIdle = () => {
      if (!usePlayer.getState().playing) location.reload();
      else usePlayer.subscribe((p) => !p.playing && location.reload());
    };
    wb.addEventListener("controlling", (e) => e.isUpdate && reloadWhenIdle());
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void wb.update());
    void wb.register();
  });
}
