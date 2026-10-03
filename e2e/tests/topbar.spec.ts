import { expect, test } from "@playwright/test";
import { openAlbum, signIn } from "./helpers.ts";

test("history controls match the glass search field and preserve navigation", async ({ page }) => {
  await signIn(page);
  await openAlbum(page, "Afterglow Avenue");

  const albumUrl = page.url();
  const searchSurface = page.locator(".top-search .sf");
  const historyButtons = page.locator(".hist .circle");

  for (const viewportWidth of [768, 1024, 1440]) {
    await page.setViewportSize({ width: viewportWidth, height: 900 });

    const searchBounds = await searchSurface.boundingBox();

    expect(searchBounds).not.toBeNull();

    for (const historyButton of await historyButtons.all()) {
      const buttonBounds = await historyButton.boundingBox();

      expect(buttonBounds).not.toBeNull();
      expect(buttonBounds?.height).toBe(searchBounds?.height);
      expect(buttonBounds?.width).toBe(searchBounds?.height);
      expect((buttonBounds?.x ?? 0) + (buttonBounds?.width ?? 0)).toBeLessThanOrEqual(searchBounds?.x ?? 0);
      await expect(historyButton).toHaveCSS("border-radius", "50%");
      await expect(historyButton).toHaveCSS(
        "backdrop-filter",
        await searchSurface.evaluate((searchElement) => getComputedStyle(searchElement).backdropFilter),
      );
    }
  }

  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await expect(page).not.toHaveURL(albumUrl);
  await page.getByRole("button", { name: "Go forward", exact: true }).click();
  await expect(page).toHaveURL(albumUrl);
});

test("opens search from the top bar on any page", async ({ page }) => {
  await signIn(page);
  await page.locator(".topbar").getByRole("searchbox", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/search/);
  await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toBeFocused();
});

test("the slash key opens search with the field focused", async ({ page }) => {
  await signIn(page, "/stats");
  await page.keyboard.press("/");
  await expect(page).toHaveURL(/\/search/);
  const field = page.getByRole("searchbox", { name: "Search", exact: true });
  await expect(field).toBeFocused();

  await field.fill("neon");
  await expect(page).toHaveURL(/q=neon/);
  await field.blur();
  await page.keyboard.press("/");
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("neon");
});

test("shows the album's name and cover in the top bar after scrolling, moving search aside", async ({ page }) => {
  await signIn(page);
  await openAlbum(page, "Afterglow Avenue");
  const top = page.locator(".topbar");
  const name = top.locator(".top-name");
  const search = top.locator(".top-search .sf");
  await expect(search.locator("input")).toHaveCSS("font-size", "15px");
  const left = async () => (await search.boundingBox())?.x ?? 0;
  const centred = await left();
  await expect(name).toBeHidden();

  const main = page.locator("#main");
  await main.evaluate((m) => m.scrollTo(0, m.scrollHeight));
  await expect(name).toHaveText("Afterglow Avenue");
  await expect(name).toBeVisible();
  await expect(top.locator(".top-cover img")).toBeVisible();
  await expect.poll(left).toBeGreaterThan(centred + 40);

  await main.evaluate((m) => m.scrollTo(0, 0));
  await expect(name).toBeHidden();
  await expect.poll(left).toBeCloseTo(centred, 0);
});

test("keeps the glass search placeholder readable over white album art", async ({ page, context }) => {
  await context.route("**/rest/getCoverArt.view?**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path fill="white" d="M0 0h100v100H0z"/></svg>',
    }),
  );
  await signIn(page);
  await openAlbum(page, "Salt & Signal");

  const searchSurface = page.locator(".top-search .sf");
  const searchInput = searchSurface.locator("input");
  await expect(searchInput).toHaveAttribute("placeholder", "What do you want to listen to?");
  await expect(searchInput).toHaveCSS("font-size", "15px");

  const searchAppearance = () =>
    searchSurface.evaluate((searchElement) => {
      const searchInputElement = searchElement.querySelector("input");
      const canvas = document.createElement("canvas");
      const canvasContext = canvas.getContext("2d");

      if (!searchInputElement || !canvasContext) throw new Error("Search field is unavailable");

      const colorComponents = (color: string) => {
        canvasContext.clearRect(0, 0, 1, 1);
        canvasContext.fillStyle = color;
        canvasContext.fillRect(0, 0, 1, 1);

        return Array.from(canvasContext.getImageData(0, 0, 1, 1).data);
      };
      const searchStyle = getComputedStyle(searchElement);
      const backgroundColor = colorComponents(searchStyle.backgroundColor);
      const placeholderColor = colorComponents(getComputedStyle(searchInputElement, "::placeholder").color);
      const backgroundAlpha = (backgroundColor[3] ?? 0) / 255;
      const backdropBrightness = Number(/brightness\(([\d.]+)\)/.exec(searchStyle.backdropFilter)?.[1] ?? 1);
      const backgroundChannels = backgroundColor
        .slice(0, 3)
        .map((colorChannel) => colorChannel * backgroundAlpha + 255 * backdropBrightness * (1 - backgroundAlpha));
      const luminance = (colorChannels: number[]) =>
        colorChannels.reduce((total, colorChannel, channelIndex) => {
          const relativeChannel = colorChannel / 255;
          const linearChannel =
            relativeChannel <= 0.04045 ? relativeChannel / 12.92 : ((relativeChannel + 0.055) / 1.055) ** 2.4;

          return total + linearChannel * ([0.2126, 0.7152, 0.0722][channelIndex] ?? 0);
        }, 0);
      const backgroundLuminance = luminance(backgroundChannels);
      const placeholderLuminance = luminance(placeholderColor.slice(0, 3));

      return {
        contrast:
          (Math.max(backgroundLuminance, placeholderLuminance) + 0.05) /
          (Math.min(backgroundLuminance, placeholderLuminance) + 0.05),
        opacity: backgroundAlpha,
      };
    });

  await expect.poll(async () => (await searchAppearance()).opacity).toBeLessThan(0.8);
  await expect.poll(async () => (await searchAppearance()).contrast).toBeGreaterThanOrEqual(4.5);
  await searchSurface.hover();
  await expect.poll(async () => (await searchAppearance()).contrast).toBeGreaterThanOrEqual(4.5);
  await expect
    .poll(() => searchSurface.evaluate((searchElement) => getComputedStyle(searchElement).backdropFilter))
    .not.toBe("none");
  await searchInput.focus();
  await expect.poll(async () => (await searchAppearance()).contrast).toBeGreaterThanOrEqual(4.5);
});
