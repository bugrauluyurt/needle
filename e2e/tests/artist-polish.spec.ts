import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";
import { mockSpotify } from "./spotify-mock.ts";

const responsiveSpotifyImages = [64, 128, 256, 384, 600, 900].map((imageWidth) => ({
  url: `https://i.scdn.co/image/artist-${imageWidth}`,
  width: imageWidth,
  height: imageWidth,
}));

const artistSources = [
  {
    source: "library",
    path: "/search?q=neon",
    artistName: "Neon Harbor",
    songTitle: "Overpass",
    releaseHeading: "Singles and EPs",
  },
  {
    source: "Spotify",
    path: "/spotify/artist/ar1",
    artistName: "Lumen Drift",
    songTitle: "Glass Song 2",
    releaseHeading: "Albums",
  },
] as const;

for (const viewportWidth of [320, 390, 768, 1024, 1440]) {
  for (const artistSource of artistSources) {
    test(`${artistSource.source} artist song controls fit at ${viewportWidth}px`, async ({ page }) => {
      await page.setViewportSize({ width: viewportWidth, height: 900 });
      await mockSpotify(page, { searchSongCount: 23 });
      await signIn(page, artistSource.path);

      if (artistSource.source === "library") {
        await page.getByRole("region", { name: "In your library", exact: true }).locator(".top-link").click();
      }

      await expect(page.getByRole("heading", { level: 1, name: artistSource.artistName })).toBeVisible();

      const songsSection = page
        .locator("section")
        .filter({ has: page.getByRole("heading", { level: 2, name: "Songs", exact: true }) });

      await songsSection.getByRole("link", { name: "Show all", exact: true }).click();
      await expect(page).toHaveURL(/section=songs/);

      const returnLink = page.getByRole("link", { name: "Back to artist", exact: true });

      await expect(returnLink).toBeVisible();

      const tableBounds = await page.locator(".artist-page .tracks").boundingBox();
      const artistBounds = await page.locator(".artist-page").boundingBox();

      expect(tableBounds).not.toBeNull();
      expect(artistBounds).not.toBeNull();
      expect(tableBounds?.x).toBe(artistBounds?.x);
      expect(tableBounds?.width).toBe(artistBounds?.width);
      await expect(page.locator(".artist-page .tracks")).toHaveCSS("padding-left", "0px");
      await expect(page.locator(".artist-page .tracks")).toHaveCSS("padding-right", "0px");

      const returnGeometry = await returnLink.evaluate((linkElement) => {
        const iconElement = linkElement.querySelector("svg");
        const textWalker = document.createTreeWalker(linkElement, NodeFilter.SHOW_TEXT);
        let textNode = textWalker.nextNode();

        while (textNode && textNode.textContent?.trim() !== "Back to artist") textNode = textWalker.nextNode();

        if (!iconElement || !textNode) throw new Error("Artist return link is incomplete");

        const textRange = document.createRange();

        textRange.selectNode(textNode);

        const iconBounds = iconElement.getBoundingClientRect();
        const textBounds = textRange.getBoundingClientRect();

        return {
          iconRight: iconBounds.right,
          textLeft: textBounds.left,
          centerDifference: Math.abs(iconBounds.y + iconBounds.height / 2 - textBounds.y - textBounds.height / 2),
        };
      });

      expect.soft(returnGeometry.iconRight).toBeLessThanOrEqual(returnGeometry.textLeft);
      expect.soft(returnGeometry.centerDifference).toBeLessThanOrEqual(3);

      await page.getByRole("button", { name: "Find in artist songs", exact: true }).click();

      const songSearch = page.getByRole("searchbox", { name: "Find in artist songs", exact: true });

      await expect(songSearch).toBeFocused();
      await expect(songSearch).toHaveCSS("font-size", "14px");
      await expect
        .poll(() =>
          songSearch.evaluate((inputElement) => {
            const inputStyle = getComputedStyle(inputElement);
            const canvasContext = document.createElement("canvas").getContext("2d");

            if (!canvasContext) throw new Error("Text measurement is unavailable");

            canvasContext.font = inputStyle.font;

            return (
              inputElement.clientWidth -
              parseFloat(inputStyle.paddingLeft) -
              parseFloat(inputStyle.paddingRight) -
              canvasContext.measureText(inputElement.getAttribute("placeholder") ?? "").width
            );
          }),
        )
        .toBeGreaterThanOrEqual(0);

      const searchBounds = await songSearch.boundingBox();

      expect(searchBounds).not.toBeNull();
      expect(searchBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((searchBounds?.x ?? 0) + (searchBounds?.width ?? 0)).toBeLessThanOrEqual(viewportWidth);
      expect(
        await songSearch.evaluate((inputElement) => {
          const headerElement = inputElement.closest(".row-h");

          if (!headerElement) throw new Error("Artist song controls are unavailable");

          return headerElement.scrollWidth - headerElement.clientWidth;
        }),
      ).toBeLessThanOrEqual(1);

      await songSearch.fill(artistSource.songTitle);
      await expect(page.locator(".artist-page .tr .name")).toHaveText([artistSource.songTitle]);
      await songSearch.fill("");
      await returnLink.click();
      await expect(page).not.toHaveURL(/section=/);
      await expect(
        page.getByRole("heading", { level: 2, name: artistSource.releaseHeading, exact: true }),
      ).toBeVisible();
      await expect(returnLink).toHaveCount(0);
    });
  }
}

test("artist return link animates without forcing motion preferences", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mockSpotify(page);
  await signIn(page, "/spotify/artist/ar1?section=songs");

  const returnLink = page.getByRole("link", { name: "Back to artist", exact: true });

  await expect(returnLink).toBeVisible();
  await expect
    .poll(() =>
      returnLink.evaluate((linkElement) => {
        const linkStyle = getComputedStyle(linkElement);

        return (
          linkStyle.animationName !== "none" &&
          linkStyle.animationDuration.split(",").some((duration) => parseFloat(duration) > 0)
        );
      }),
    )
    .toBe(true);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      returnLink.evaluate((linkElement) => {
        const linkStyle = getComputedStyle(linkElement);

        return linkStyle.animationDuration.split(",").every((duration) => parseFloat(duration) <= 0.001);
      }),
    )
    .toBe(true);
});

for (const artistSource of artistSources) {
  test(`${artistSource.source} artist hero loads responsive artwork`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockSpotify(page, { artistImages: responsiveSpotifyImages });
    await signIn(page, artistSource.path);

    if (artistSource.source === "library") {
      await page.getByRole("region", { name: "In your library", exact: true }).locator(".top-link").click();
    }

    const artistImage = page.locator(".a-hero .bg .art img");
    const getArtistSourceWidth = async () => {
      const artistSourceUrl = await artistImage.evaluate((artistElement) => {
        if (!(artistElement instanceof HTMLImageElement)) throw new Error("Artist artwork is not an image");

        return artistElement.currentSrc;
      });

      if (!artistSourceUrl) return 0;

      if (artistSource.source === "library")
        return Number(new URL(artistSourceUrl, page.url()).searchParams.get("size"));

      return Number(artistSourceUrl.match(/artist-(\d+)$/)?.[1]);
    };

    await expect(page.getByRole("heading", { level: 1, name: artistSource.artistName })).toBeVisible();
    await expect(artistImage).toHaveAttribute("sizes", "100vw");
    await expect(artistImage).toHaveAttribute("srcset", /64w.*128w.*256w.*384w.*600w.*900w/);
    await expect(artistImage).toHaveCSS("object-fit", "cover");
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);
    const artworkDimensions = await artistImage.evaluate((artistElement) => {
      if (!(artistElement instanceof HTMLImageElement)) throw new Error("Artist artwork is not an image");

      return {
        imageWidth: artistElement.offsetWidth,
        imageHeight: artistElement.offsetHeight,
        containerWidth: artistElement.parentElement?.clientWidth,
        containerHeight: artistElement.parentElement?.clientHeight,
      };
    });

    expect(artworkDimensions.imageWidth).toBe(artworkDimensions.containerWidth);
    expect(artworkDimensions.imageHeight).toBe(artworkDimensions.containerHeight);

    await expect.poll(getArtistSourceWidth).toBeGreaterThanOrEqual(384);

    const selectedPhoneArtistWidth = await getArtistSourceWidth();

    expect(selectedPhoneArtistWidth).toBeLessThanOrEqual(600);

    await page.setViewportSize({ width: 1440, height: 900 });

    await expect.poll(getArtistSourceWidth).toBe(900);
  });
}
