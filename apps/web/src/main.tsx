import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
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

if ("serviceWorker" in navigator && import.meta.env.PROD && window.isSecureContext) {
  void import("workbox-window").then(({ Workbox }) => {
    const wb = new Workbox("/sw.js");
    void wb.register();
  });
}
