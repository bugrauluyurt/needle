self.addEventListener("activate", (activationEvent) => {
  activationEvent.waitUntil(caches.delete("covers"));
});
