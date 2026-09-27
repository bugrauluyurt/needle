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
