import { deviceKind, isIOS, isStandalone } from "../lib/device.ts";

export function initializeViewport(): void {
  if (!isStandalone || deviceKind() === "desktop") return;

  document.documentElement.classList.add("standalone-mobile");

  const viewportMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');

  if (viewportMeta) {
    viewportMeta.content =
      "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
  }

  if (isIOS) {
    const preventGestureZoom = (gestureEvent: Event) => gestureEvent.preventDefault();

    for (const gestureName of ["gesturestart", "gesturechange"]) {
      document.addEventListener(gestureName, preventGestureZoom, { passive: false });
    }
  }
}
