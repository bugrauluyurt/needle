import { describe, expect, it } from "vitest";
import type { Song } from "@needle/shared";
import * as Q from "../src/player/queue.ts";

const song = (id: string): Song => ({ id, title: `Song ${id}` });
const songs = (...ids: string[]) => ids.map(song);
const ids = (q: Q.QueueState) => q.items.map((i) => i.song.id);
const seq = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
};

describe("queue", () => {
  it("starts at the chosen song, in order, without shuffle", () => {
    const q = Q.start(songs("a", "b", "c"), 1, false);
    expect(ids(q)).toEqual(["a", "b", "c"]);
    expect(q.index).toBe(1);
    expect(q.original).toBeNull();
  });

  it("puts the chosen song first when shuffling and keeps the original order", () => {
    const q = Q.start(songs("a", "b", "c", "d"), 2, true, seq([0.1, 0.9, 0.5]));
    expect(q.items[0]?.song.id).toBe("c");
    expect(q.index).toBe(0);
    expect(new Set(ids(q))).toEqual(new Set(["a", "b", "c", "d"]));
    expect(q.original?.map((i) => i.song.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("adds to the queue after the current song and earlier queued songs", () => {
    let q = Q.start(songs("a", "b", "c"), 0, false);
    q = Q.addToQueue(q, songs("x"));
    q = Q.addToQueue(q, songs("y"));
    expect(ids(q)).toEqual(["a", "x", "y", "b", "c"]);
    expect(Q.userItemsAfter(q)).toBe(2);
  });

  it("plays next straight after the current song", () => {
    let q = Q.start(songs("a", "b", "c"), 0, false);
    q = Q.addToQueue(q, songs("x"));
    q = Q.playNext(q, songs("n"));
    expect(ids(q)).toEqual(["a", "n", "x", "b", "c"]);
  });

  it("starts from an empty queue when adding", () => {
    const q = Q.addToQueue(
      { items: [], index: -1, original: null },
      songs("a"),
    );
    expect(ids(q)).toEqual(["a"]);
    expect(q.index).toBe(0);
  });

  it("removes songs but never the current one", () => {
    const q = Q.start(songs("a", "b", "c"), 1, false);
    const a = q.items[0]?.uid ?? "";
    const b = q.items[1]?.uid ?? "";
    expect(ids(Q.remove(q, b))).toEqual(["a", "b", "c"]);
    const removed = Q.remove(q, a);
    expect(ids(removed)).toEqual(["b", "c"]);
    expect(removed.index).toBe(0);
  });

  it("moves an upcoming song and ignores moves before the current one", () => {
    const q = Q.start(songs("a", "b", "c", "d"), 0, false);
    const d = q.items[3]?.uid ?? "";
    expect(ids(Q.move(q, d, 1))).toEqual(["a", "d", "b", "c"]);
    expect(ids(Q.move(q, d, 0))).toEqual(["a", "b", "c", "d"]);
  });

  it("clears only queued songs that are still to come", () => {
    let q = Q.start(songs("a", "b"), 0, false);
    q = Q.addToQueue(q, songs("x", "y"));
    expect(ids(Q.clearUserQueue(q))).toEqual(["a", "b"]);
  });

  it("shuffles upcoming songs but keeps queued songs next", () => {
    let q = Q.start(songs("a", "b", "c", "d", "e"), 0, false);
    q = Q.addToQueue(q, songs("x"));
    const s = Q.setShuffle(q, true, seq([0, 0, 0, 0]));
    expect(s.items[0]?.song.id).toBe("a");
    expect(s.items[1]?.song.id).toBe("x");
    expect(new Set(ids(s).slice(2))).toEqual(new Set(["b", "c", "d", "e"]));
  });

  it("restores the album order when shuffle turns off, from the current song", () => {
    const q = Q.start(songs("a", "b", "c", "d"), 0, false);
    const on = Q.setShuffle(q, true, seq([0.99, 0.01, 0.5]));
    const moved = {
      ...on,
      index: on.items.findIndex((i) => i.song.id === "c"),
    };
    const off = Q.setShuffle(moved, false);
    expect(ids(off)).toEqual(["a", "b", "c", "d"]);
    expect(off.items[off.index]?.song.id).toBe("c");
    expect(off.original).toBeNull();
  });

  it("keeps queued songs next when shuffle turns off", () => {
    let q = Q.start(songs("a", "b", "c"), 0, true, seq([0.5]));
    q = Q.addToQueue(q, songs("x"));
    const off = Q.setShuffle(q, false);
    expect(off.items[off.index]?.song.id).toBe("a");
    expect(off.items[off.index + 1]?.song.id).toBe("x");
  });

  it("works out next and previous with each repeat mode", () => {
    const q = Q.start(songs("a", "b"), 1, false);
    expect(Q.nextIndex(q, "off")).toBeNull();
    expect(Q.nextIndex(q, "all")).toBe(0);
    expect(Q.previousIndex({ ...q, index: 0 }, "off")).toBeNull();
    expect(Q.previousIndex({ ...q, index: 0 }, "all")).toBe(1);
    expect(
      Q.nextIndex({ items: [], index: -1, original: null }, "all"),
    ).toBeNull();
  });
});
