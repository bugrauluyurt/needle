export const OTHER_VERSIONS = [
  "live",
  "remix",
  "karaoke",
  "instrumental",
  "cover",
  "acoustic",
  "demo",
  "edit",
  "video",
  "excerpt",
];

export function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ı/g, "i").toLowerCase();
}

export function queryTerms(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

export function matchesTerms(terms: string[], ...fields: (string | undefined | null)[]): boolean {
  const hay = fold(fields.filter(Boolean).join(" "));
  return terms.every((t) => hay.includes(t));
}

export function songKey(artist: string, title: string): string {
  const bare = title.replace(/\s*[([][^)\]]*[)\]]/g, "").replace(/\s+-\s+.*$/, "");
  return `${fold(artist).trim()}|${fold(bare).trim()}`;
}
