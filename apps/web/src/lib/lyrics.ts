import type { StructuredLyrics } from "@needle/shared";

export function pickLyrics(
  list: StructuredLyrics[] | undefined,
): StructuredLyrics | null {
  if (!list?.length) return null;
  return (
    list.find((l) => l.synced && l.line?.length) ??
    list.find((l) => l.line?.length) ??
    null
  );
}

export function lineAt(lines: { start?: number }[], ms: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid]?.start ?? 0) <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
