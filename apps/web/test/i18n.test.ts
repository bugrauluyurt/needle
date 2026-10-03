import { afterEach, describe, expect, it, vi } from "vitest";

function memoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("language settings", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("defaults to English and persists a manual Turkish selection", async () => {
    const localStorage = memoryStorage();

    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("window", { localStorage });

    const { useSettings } = await import("../src/state/settings.ts");

    expect(useSettings.getState().language).toBe("en");

    useSettings.getState().set("language", "tr");

    expect(JSON.parse(localStorage.getItem("needle.settings") ?? "null")).toMatchObject({ state: { language: "tr" } });

    vi.resetModules();

    const { useSettings: reloadedSettings } = await import("../src/state/settings.ts");

    expect(reloadedSettings.getState().language).toBe("tr");
  });

  it("updates Turkish core labels and document language", async () => {
    const localStorage = memoryStorage();
    const manifestLink = { setAttribute: vi.fn() };
    const description = { setAttribute: vi.fn() };
    const documentElement = { dir: "ltr", lang: "en" };

    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("document", {
      documentElement,
      title: "Needle",
      querySelector: vi.fn((selector: string) => {
        if (selector === "link[rel='manifest']") return manifestLink;
        if (selector === "meta[name='description']") return description;

        return null;
      }),
    });

    const { changeLanguage, translate } = await import("../src/i18n/index.ts");
    const { ago, count, plural, releaseDateLabel } = await import("../src/lib/format.ts");

    await changeLanguage("tr");

    expect(translate("navigation.home")).toBe("Ana Sayfa");
    expect(translate("navigation.search")).toBe("Ara");
    expect(count(12_345)).toBe("12.345");
    expect(plural(2, "song")).toBe("2 şarkı");
    expect(ago("2026-10-02T12:00:00.000Z", Date.parse("2026-10-03T12:00:00.000Z"))).toBe("Dün");
    expect(releaseDateLabel({ releaseDate: "2024-03" })).toBe("Mar 2024");
    expect(documentElement.lang).toBe("tr");
    expect(manifestLink.setAttribute).toHaveBeenCalledWith("href", "/manifest.tr.webmanifest");
  });
});
