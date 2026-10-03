import { describe, expect, it } from "vitest";
import { songKey } from "../src/search.ts";

describe("song search keys", () => {
  it("removes parenthesized versions and trailing qualifiers", () => {
    expect(songKey("The Artist", "The Song (Live) [Remix] - 2024 Remaster")).toBe("the artist|the song");
  });

  it("keeps tolerant delimiter matching used by existing song identities", () => {
    expect(songKey("The Artist", "The Song (Live]")).toBe("the artist|the song");
    expect(songKey("The Artist", "The Song ([Live])")).toBe("the artist|the song)");
  });

  it("does not remove trailing qualifiers across line terminators", () => {
    expect(songKey("The Artist", "The Song - Remix\nOther")).toBe("the artist|the song - remix\nother");
    expect(songKey("The Artist", "The Song - \nRemix")).toBe("the artist|the song");
  });

  it("handles unterminated metadata without polynomial backtracking", { timeout: 2_000 }, () => {
    const title = `Song (${" ".repeat(100_000)}`;

    expect(songKey("The Artist", title)).toBe("the artist|song (");
  });
});
