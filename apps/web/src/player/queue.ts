import type { Song } from "@needle/shared";

export type QueueItem = { uid: string; song: Song; fromUser?: boolean };
export type Repeat = "off" | "all" | "one";

export type QueueState = {
  items: QueueItem[];
  index: number;
  original: QueueItem[] | null;
};

let uidCounter = 0;
export const makeItem = (song: Song, fromUser = false): QueueItem => ({ uid: `q${Date.now().toString(36)}${(uidCounter++).toString(36)}`, song, ...(fromUser ? { fromUser } : {}) });

export function shuffleArray<T>(arr: T[], random = Math.random): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export function start(songs: Song[], startIndex: number, shuffle: boolean, random = Math.random): QueueState {
  const items = songs.map((s) => makeItem(s));
  if (!shuffle) return { items, index: Math.max(0, Math.min(startIndex, items.length - 1)), original: null };
  const first = items[startIndex] ?? items[0];
  if (!first) return { items: [], index: -1, original: null };
  const rest = shuffleArray(items.filter((i) => i !== first), random);
  return { items: [first, ...rest], index: 0, original: items };
}

export function userItemsAfter(q: QueueState): number {
  let n = 0;
  for (let i = q.index + 1; i < q.items.length && q.items[i]?.fromUser; i++) n++;
  return n;
}

export function addToQueue(q: QueueState, songs: Song[]): QueueState {
  const at = q.index + 1 + userItemsAfter(q);
  const added = songs.map((s) => makeItem(s, true));
  const items = [...q.items.slice(0, at), ...added, ...q.items.slice(at)];
  return { ...q, items, index: q.items.length ? q.index : 0, original: q.original ? [...q.original, ...added] : null };
}

export function playNext(q: QueueState, songs: Song[]): QueueState {
  const at = q.index + 1;
  const added = songs.map((s) => makeItem(s, true));
  return {
    ...q,
    items: [...q.items.slice(0, at), ...added, ...q.items.slice(at)],
    index: q.items.length ? q.index : 0,
    original: q.original ? [...q.original, ...added] : null,
  };
}

export function remove(q: QueueState, uid: string): QueueState {
  const i = q.items.findIndex((it) => it.uid === uid);
  if (i < 0 || i === q.index) return q;
  const items = q.items.filter((it) => it.uid !== uid);
  return { ...q, items, index: i < q.index ? q.index - 1 : q.index, original: q.original?.filter((it) => it.uid !== uid) ?? null };
}

export function move(q: QueueState, uid: string, toIndex: number): QueueState {
  const from = q.items.findIndex((it) => it.uid === uid);
  if (from < 0 || from === q.index || toIndex <= q.index) return q;
  const items = q.items.slice();
  const [it] = items.splice(from, 1);
  if (!it) return q;
  const target = Math.min(toIndex, items.length);
  items.splice(target, 0, it);
  return { ...q, items, index: from < q.index ? q.index - 1 : q.index };
}

export function clearUserQueue(q: QueueState): QueueState {
  const items = q.items.filter((it, i) => i <= q.index || !it.fromUser);
  return { ...q, items, original: q.original?.filter((it) => !it.fromUser) ?? null };
}

export function setShuffle(q: QueueState, on: boolean, random = Math.random): QueueState {
  const current = q.items[q.index];
  if (!current) return { ...q, original: on ? q.items : null };
  if (on) {
    const upcoming = q.items.slice(q.index + 1);
    const user = upcoming.filter((it) => it.fromUser);
    const context = shuffleArray(upcoming.filter((it) => !it.fromUser), random);
    return { items: [...q.items.slice(0, q.index + 1), ...user, ...context], index: q.index, original: q.original ?? q.items };
  }
  const original = q.original ?? q.items;
  const pos = original.findIndex((it) => it.uid === current.uid);
  const pendingUser = q.items.slice(q.index + 1).filter((it) => it.fromUser);
  const pendingUids = new Set(pendingUser.map((it) => it.uid));
  const rest = original.slice(pos + 1).filter((it) => !pendingUids.has(it.uid));
  const before = original.slice(0, pos).filter((it) => !pendingUids.has(it.uid));
  return { items: [...before, current, ...pendingUser, ...rest], index: before.length, original: null };
}

export function nextIndex(q: QueueState, repeat: Repeat): number | null {
  if (!q.items.length) return null;
  if (q.index + 1 < q.items.length) return q.index + 1;
  return repeat === "all" ? 0 : null;
}

export function previousIndex(q: QueueState, repeat: Repeat): number | null {
  if (!q.items.length) return null;
  if (q.index > 0) return q.index - 1;
  return repeat === "all" ? q.items.length - 1 : null;
}
