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

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/u.test(character);
}

type DelimiterRole = "open" | "close";

function delimiterRole(character: string | undefined): DelimiterRole | null {
  switch (character) {
    case "(":
    case "[":
      return "open";
    case ")":
    case "]":
      return "close";
    default:
      return null;
  }
}

function lastLineTerminatorIndex(text: string): number {
  for (let characterIndex = text.length - 1; characterIndex >= 0; characterIndex -= 1) {
    switch (text[characterIndex]) {
      case "\n":
      case "\r":
      case "\u2028":
      case "\u2029":
        return characterIndex;
    }
  }

  return -1;
}

function titleWithoutVersions(title: string): string {
  const titleParts: string[] = [];
  let partStart = 0;
  let whitespaceStart = -1;
  let versionStart = -1;

  for (let characterIndex = 0; characterIndex < title.length; characterIndex += 1) {
    const character = title[characterIndex];
    const role = delimiterRole(character);

    if (versionStart !== -1) {
      if (role !== "close") continue;

      titleParts.push(title.slice(partStart, whitespaceStart === -1 ? versionStart : whitespaceStart));
      partStart = characterIndex + 1;
      whitespaceStart = -1;
      versionStart = -1;

      continue;
    }

    if (role === "open") {
      versionStart = characterIndex;

      continue;
    }

    if (isWhitespace(character)) {
      if (whitespaceStart === -1) whitespaceStart = characterIndex;
    } else {
      whitespaceStart = -1;
    }
  }

  titleParts.push(title.slice(partStart));

  return titleParts.join("");
}

function titleWithoutTrailingQualifier(title: string): string {
  const finalLineTerminatorIndex = lastLineTerminatorIndex(title);
  let whitespaceStart = -1;

  for (let characterIndex = 0; characterIndex < title.length; characterIndex += 1) {
    const character = title[characterIndex];

    if (isWhitespace(character)) {
      if (whitespaceStart === -1) whitespaceStart = characterIndex;

      continue;
    }

    if (character === "-" && whitespaceStart !== -1 && isWhitespace(title[characterIndex + 1])) {
      let suffixStart = characterIndex + 1;

      while (isWhitespace(title[suffixStart])) suffixStart += 1;

      if (finalLineTerminatorIndex < suffixStart) return title.slice(0, whitespaceStart);
    }

    whitespaceStart = -1;
  }

  return title;
}

export function songKey(artist: string, title: string): string {
  const bare = titleWithoutTrailingQualifier(titleWithoutVersions(title));

  return `${fold(artist).trim()}|${fold(bare).trim()}`;
}
