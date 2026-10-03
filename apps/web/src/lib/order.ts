export type Order<K extends string> = { key: K; desc: boolean };

const DESC_FIRST: ReadonlySet<string> = new Set(["added", "plays", "year"]);
const UNORDERED: ReadonlySet<string> = new Set(["custom", "default"]);

export const directional = (key: string) => !UNORDERED.has(key);

export const naturalOrder = <K extends string>(key: K): Order<K> => ({
  key,
  desc: DESC_FIRST.has(key),
});

export const pickOrder = <K extends string>(order: Order<K>, key: K): Order<K> =>
  order.key === key ? { key, desc: !order.desc } : naturalOrder(key);

export function nextOrder<K extends string>(order: Order<K>, key: K, fallback: Order<K>): Order<K> {
  if (order.key !== key) return naturalOrder(key);
  return order.desc === naturalOrder(key).desc ? { key, desc: !order.desc } : fallback;
}

export const compareText = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

export function applyOrder<T>(items: T[], compare: ((a: T, b: T) => number) | undefined, desc: boolean): T[] {
  if (!compare) return items;
  return items.toSorted(desc ? (a, b) => compare(b, a) : compare);
}
