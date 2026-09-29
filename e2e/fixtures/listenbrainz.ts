export const LB_TOKEN = "test-lb-token";
export const LB_USER = "needle-tester";
export const UNDERTOW_MBID = "0c6f0f3e-5d5e-4b6f-9a55-6f2f1b0e7a01";

const recording = (mbid: string, title: string, creator: string, album: string, seconds: number) => ({
  identifier: [`https://musicbrainz.org/recording/${mbid}`],
  title, creator, album, duration: seconds * 1000,
  extension: { "https://musicbrainz.org/doc/jspf#track": { additional_metadata: { caa_release_mbid: null, caa_id: null } } },
});

const playlist = (mbid: string, title: string, patch: string, annotation: string, track: ReturnType<typeof recording>[]) => ({
  identifier: `https://listenbrainz.org/playlist/${mbid}`,
  title, annotation, creator: "listenbrainz", date: "2026-09-28T00:00:00+00:00", track,
  extension: { "https://musicbrainz.org/doc/jspf#playlist": { created_for: LB_USER, public: true, additional_metadata: { algorithm_metadata: { source_patch: patch } } } },
});

export const LB_PLAYLISTS = [
  playlist("7d1c1b52-8f0c-4c11-9a0e-2c7a3e0f1a01", `Weekly Exploration for ${LB_USER}, week of 2026-09-28 Mon`, "weekly-exploration",
    "<p>The Weekly Exploration playlist is a set of songs you haven&#39;t heard before, picked from what listeners like you enjoy.</p>", [
      recording("0c6f0f3e-5d5e-4b6f-9a55-6f2f1b0e7a11", "Chrome Horizon", "Neon Harbor", "Afterglow Avenue", 36),
      recording(UNDERTOW_MBID, "Undertow", "Glass Harbor", "Tidal", 212),
      recording("0c6f0f3e-5d5e-4b6f-9a55-6f2f1b0e7a12", "Galata", "Kasa Kaan", "İstanbul'da Gece", 38),
      recording("0c6f0f3e-5d5e-4b6f-9a55-6f2f1b0e7a13", "Slow Tide", "Lumen Field", "Weightless Hours", 58),
    ]),
  playlist("7d1c1b52-8f0c-4c11-9a0e-2c7a3e0f1a02", `Weekly Jams for ${LB_USER}, week of 2026-09-28 Mon`, "weekly-jams",
    "<p>The songs you played most, and more like them.</p>", [
      recording("0c6f0f3e-5d5e-4b6f-9a55-6f2f1b0e7a14", "Afterglow Avenue", "Neon Harbor", "Afterglow Avenue", 42),
      recording("0c6f0f3e-5d5e-4b6f-9a55-6f2f1b0e7a15", "Blue Minutes", "Okto Quartet", "Blue Minutes", 46),
    ]),
];
