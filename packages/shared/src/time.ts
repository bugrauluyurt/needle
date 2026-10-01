import type { ItemDate } from "./subsonic.ts";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const QUARTER_DAYS = 90;
export const REPLACED_CLOSE_CODE = 4000;

export function releaseDateString(releaseDate: ItemDate | undefined): string | undefined {
  if (!releaseDate?.year || !Number.isInteger(releaseDate.year)) return undefined;

  const year = String(releaseDate.year).padStart(4, "0");

  if (!releaseDate.month) return year;

  const month = String(releaseDate.month).padStart(2, "0");
  const day = String(releaseDate.day ?? 1).padStart(2, "0");
  const parsedReleaseDate = new Date(`${year}-${month}-${day}T00:00:00Z`);

  if (parsedReleaseDate.getUTCFullYear() !== releaseDate.year || parsedReleaseDate.getUTCMonth() + 1 !== releaseDate.month || parsedReleaseDate.getUTCDate() !== (releaseDate.day ?? 1)) return undefined;

  return releaseDate.day ? `${year}-${month}-${day}` : `${year}-${month}`;
}
