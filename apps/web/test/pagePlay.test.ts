import { afterEach, describe, expect, it } from "vitest";
import { showPagePlay, usePagePlay } from "../src/state/pagePlay.ts";

const entry = (contextId: string) => ({ contextId, label: `Album ${contextId}`, onPlay: () => undefined });

describe("page play", () => {
  afterEach(() => usePagePlay.setState({ entry: null }));

  it("starts empty", () => {
    expect(usePagePlay.getState().entry).toBeNull();
  });

  it("holds the page's play entry until it is cleared", () => {
    const album = entry("a");
    const clear = showPagePlay(album);
    expect(usePagePlay.getState().entry).toBe(album);
    clear();
    expect(usePagePlay.getState().entry).toBeNull();
  });

  it("keeps a newer page's entry when an older page clears", () => {
    const clearOld = showPagePlay(entry("old"));
    const next = entry("new");
    showPagePlay(next);
    clearOld();
    expect(usePagePlay.getState().entry).toBe(next);
  });
});
