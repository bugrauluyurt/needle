import { expect, test } from "@playwright/test";
import type { AlbumWithSongs, SubsonicEnvelope } from "@needle/shared";
import { bar, openAlbum, playContext, signIn } from "./helpers.ts";

test("likes a song and finds it in Liked songs", async ({ page }) => {
  await signIn(page);
  await openAlbum(page, "Salt & Signal");
  const row = page.locator(".tr", { hasText: "Lighthouse Keeper" });
  await row.hover();
  await row.getByRole("button", { name: "Add Lighthouse Keeper to liked songs" }).click();
  await expect(row.getByRole("button", { name: "Remove Lighthouse Keeper from liked songs" })).toBeVisible();

  await page
    .getByRole("link", { name: /Liked songs/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Liked songs" })).toBeVisible();
  await expect(page.locator(".tr", { hasText: "Lighthouse Keeper" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Find in liked songs" }).fill("lighthouse");
  await expect(page.locator(".tr")).toHaveCount(1);

  await page
    .locator(".tr", { hasText: "Lighthouse Keeper" })
    .getByRole("button", { name: "Remove Lighthouse Keeper from liked songs" })
    .click();
  await expect(page.locator(".tr")).toHaveCount(0);
});

test("lists every album in the library and likes one", async ({ page }) => {
  await signIn(page);
  const side = page.locator(".side");
  await side.getByRole("button", { name: "Albums", exact: true }).click();
  await expect(side.locator(".lib-item", { hasText: "Pulse Theory" })).toBeVisible();
  await expect(side.locator(".lib-item", { hasText: "Late night drive" })).toHaveCount(0);
  await side.getByRole("button", { name: "Albums", exact: true }).click();
  await openAlbum(page, "Pulse Theory");
  await page.getByRole("button", { name: "Add to your liked albums" }).click();
  await side.locator(".lib-item", { hasText: "Liked albums" }).click();
  await expect(page.locator(".card", { hasText: "Pulse Theory" })).toBeVisible();
  await openAlbum(page, "Pulse Theory");
  await page.getByRole("button", { name: "Remove from your liked albums" }).click();
  await page.goto("/albums/starred");
  await expect(page.locator(".card", { hasText: "Pulse Theory" })).toHaveCount(0);
});

test("navigates overflowing library filters and collapses the selected filter", async ({ page }) => {
  await signIn(page);

  const libraryFilters = page.locator(".side .library-chips");
  const libraryFilterScroller = libraryFilters.locator(".chips");
  const albumsFilter = libraryFilters.getByRole("button", { name: "Albums", exact: true });
  const onDeviceFilter = libraryFilters.getByRole("button", { name: "On this device", exact: true });
  const showMoreFilters = libraryFilters.getByRole("button", { name: "Show more library filters", exact: true });
  const showPreviousFilters = libraryFilters.getByRole("button", {
    name: "Show previous library filters",
    exact: true,
  });
  const onDeviceIsFullyVisible = () =>
    libraryFilterScroller.evaluate((libraryFilterScrollerElement) => {
      const libraryFilterScrollerRect = libraryFilterScrollerElement.getBoundingClientRect();
      const onDeviceElement = [...libraryFilterScrollerElement.querySelectorAll("button")].find(
        (filterButton) => filterButton.textContent === "On this device",
      );

      if (!onDeviceElement) return false;

      const onDeviceRect = onDeviceElement.getBoundingClientRect();

      return (
        onDeviceRect.left >= libraryFilterScrollerRect.left && onDeviceRect.right <= libraryFilterScrollerRect.right
      );
    });

  await expect(showMoreFilters).toBeVisible();
  await expect(showPreviousFilters).toBeHidden();
  await expect.poll(onDeviceIsFullyVisible).toBe(false);

  await showMoreFilters.focus();
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      libraryFilterScroller.evaluate((libraryFilterScrollerElement) => libraryFilterScrollerElement.scrollLeft),
    )
    .toBeGreaterThan(0);
  await expect.poll(onDeviceIsFullyVisible).toBe(true);
  await expect(showPreviousFilters).toBeVisible();
  await expect(showMoreFilters).toBeHidden();
  await expect(showPreviousFilters).toBeFocused();

  await page.keyboard.press("Space");
  await expect
    .poll(() =>
      libraryFilterScroller.evaluate((libraryFilterScrollerElement) => libraryFilterScrollerElement.scrollLeft),
    )
    .toBe(0);
  await expect(showPreviousFilters).toBeHidden();
  await expect(showMoreFilters).toBeVisible();
  await expect(showMoreFilters).toBeFocused();

  await albumsFilter.click();
  await expect(albumsFilter).toHaveAttribute("aria-pressed", "true");
  await expect(libraryFilters.getByRole("button")).toHaveCount(2);
  await expect(libraryFilters.getByRole("button", { name: "Playlists", exact: true })).toHaveCount(0);
  await expect(libraryFilters.getByRole("button", { name: "Artists", exact: true })).toHaveCount(0);
  await expect(onDeviceFilter).toHaveCount(0);

  const clearLibraryFilter = libraryFilters.getByRole("button", { name: "Clear library filter", exact: true });

  await clearLibraryFilter.focus();
  await page.keyboard.press("Enter");
  await expect(clearLibraryFilter).toHaveCount(0);
  await expect(libraryFilters.getByRole("group", { name: "Filter your library" }).getByRole("button")).toHaveCount(4);
  await expect(showMoreFilters).toBeVisible();
});

test("creates, fills, renames, reorders and deletes a playlist", async ({ page }) => {
  await signIn(page);
  await page.locator(".side").getByRole("button", { name: "Create playlist" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit details" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill("Test drive");
  await dialog.getByLabel("Description").fill("Made by the end-to-end tests");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Test drive" })).toBeVisible();
  await expect(page.getByText("Made by the end-to-end tests")).toBeVisible();

  for (const [album, song] of [
    ["Night Transit", "Overpass"],
    ["Night Transit", "Arrivals"],
  ] as const) {
    await openAlbum(page, album);
    await page.locator(".tr", { hasText: song }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Add to playlist" }).hover();
    await page.getByRole("menuitem", { name: "Test drive" }).click();
    await expect(page.getByText("Added to Test drive")).toBeVisible();
  }

  await page.locator(".side .lib-item", { hasText: "Test drive" }).click();
  const rows = page.locator(".tr .name");
  await expect(rows).toHaveText(["Overpass", "Arrivals"]);
  await page.locator(".tr", { hasText: "Arrivals" }).dragTo(page.locator(".tr", { hasText: "Overpass" }));
  await expect(rows).toHaveText(["Arrivals", "Overpass"]);
  await page.reload();
  await expect(rows).toHaveText(["Arrivals", "Overpass"]);

  await page.locator(".tr", { hasText: "Overpass" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove from this playlist" }).click();
  await expect(rows).toHaveText(["Arrivals"]);

  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByRole("dialog", { name: "Edit details" }).getByRole("button", { name: "Delete playlist" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.locator(".lib-item", { hasText: "Test drive" })).toHaveCount(0);
});

test("finds songs in a playlist and sorts them", async ({ page }) => {
  await signIn(page);
  await page.locator(".side .lib-item", { hasText: "Late night drive" }).click();
  const rows = page.locator(".tr .name");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(5);
  await page.getByRole("button", { name: /Custom order/ }).click();
  await page.getByRole("menuitemradio", { name: "Title" }).click();
  const titles = await rows.allTextContents();
  expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
  await page.getByRole("button", { name: "Find in playlist" }).click();
  await page.getByRole("searchbox", { name: "Find in playlist" }).fill(titles[0] ?? "");
  await expect(rows).toHaveCount(1);
});

test("sorts a song table from its column titles, both ways", async ({ page }) => {
  await signIn(page);
  await page.locator(".side .lib-item", { hasText: "Late night drive" }).click();
  const rows = page.locator(".tr .name");
  await expect(rows.first()).toBeVisible();
  const title = page.getByRole("columnheader", { name: "Sort by title" });
  const sorted = (desc: boolean) => async () => {
    const titles = await rows.allTextContents();
    const expected = [...titles].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
    return titles.join("|") === (desc ? expected.reverse() : expected).join("|");
  };
  await title.getByRole("button").click();
  await expect(title).toHaveAttribute("aria-sort", "ascending");
  await expect.poll(sorted(false)).toBe(true);
  await expect(page.getByRole("button", { name: /^Sort: Title, ascending/ })).toBeVisible();
  await title.getByRole("button").click();
  await expect(title).toHaveAttribute("aria-sort", "descending");
  await expect.poll(sorted(true)).toBe(true);
  await title.getByRole("button").click();
  await expect(title).toHaveAttribute("aria-sort", "none");
  await expect(page.getByRole("button", { name: /^Sort: Custom order/ })).toBeVisible();
});

test("finds an album song without changing its disc number or playback position", async ({ page }) => {
  await page.route("**/rest/getAlbum.view", async (route) => {
    const albumResponse = await route.fetch();
    const albumEnvelope = (await albumResponse.json()) as SubsonicEnvelope<{ album: AlbumWithSongs }>;
    const album = albumEnvelope["subsonic-response"].album;

    if (album.name === "Salt & Signal") {
      album.song = album.song?.map((song, songIndex) => ({
        ...song,
        discNumber: songIndex < 2 ? 1 : 2,
        track: songIndex < 2 ? songIndex + 1 : songIndex - 1,
      }));
    }

    await route.fulfill({ response: albumResponse, json: albumEnvelope });
  });
  await signIn(page);
  await openAlbum(page, "Salt & Signal");
  await expect(page.getByRole("heading", { name: "Disc 2", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Find in album", exact: true }).click();
  await page.getByRole("searchbox", { name: "Find in album", exact: true }).fill("Northern");

  const filteredSong = page.locator(".tr", { hasText: "Northern Line" });
  await expect(page.locator(".tr")).toHaveCount(1);
  await expect(filteredSong.locator(".num")).toHaveText("2");
  await expect(page.getByRole("heading", { name: "Disc 2", exact: true })).toBeVisible();
  await filteredSong.hover();
  await filteredSong.getByRole("button", { name: "Play Northern Line", exact: true }).click();
  await expect(bar(page).locator(".np-t")).toHaveText("Northern Line");
  await bar(page).getByRole("button", { name: "Next", exact: true }).click();
  await expect(bar(page).locator(".np-t")).toHaveText("Kettle Song");
  await bar(page).getByRole("button", { name: "Previous", exact: true }).click();
  await bar(page).getByRole("button", { name: "Previous", exact: true }).click();
  await expect(bar(page).locator(".np-t")).toHaveText("Paper Boats");
});

test("reveals the full title when a song name is clipped", async ({ page }) => {
  const longSongTitle = "Lighthouse Keeper, live in the little room above the harbor on a rainy evening";
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.route("**/rest/getAlbum.view", async (route) => {
    const albumResponse = await route.fetch();
    const albumEnvelope = (await albumResponse.json()) as SubsonicEnvelope<{ album: AlbumWithSongs }>;
    const album = albumEnvelope["subsonic-response"].album;

    if (album.name === "Salt & Signal") {
      album.song = album.song?.map((song) =>
        song.title === "Lighthouse Keeper" ? { ...song, title: longSongTitle } : song,
      );
    }

    await route.fulfill({ response: albumResponse, json: albumEnvelope });
  });
  await signIn(page);
  await openAlbum(page, "Salt & Signal");
  const songTitle = page.locator(".tr .name", { hasText: longSongTitle });
  await expect(songTitle).toBeVisible();
  expect(await songTitle.evaluate((titleElement) => titleElement.scrollWidth > titleElement.clientWidth)).toBe(true);
  await songTitle.hover();
  await expect(page.getByRole("tooltip")).toHaveText(longSongTitle);
  await page.locator(".hero h1").hover();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
});

test("plays a mix from Home and a genre", async ({ page }) => {
  await signIn(page);
  const mix = page.locator(".card", { hasText: "Synthwave" }).first();
  await mix.hover();
  await mix.getByRole("button", { name: "Play Synthwave" }).click();
  await expect(page.locator("footer.bar .np-t")).not.toHaveText("Nothing playing");
  await page.goto("/genre/Jazz");
  await expect(page.getByRole("heading", { level: 1, name: "Jazz" })).toBeVisible();
  await playContext(page);
  await expect(page.locator("footer.bar .np-a")).toHaveText("Okto Quartet");
});

test("jumps back to the playing song in a long list", async ({ page }) => {
  await signIn(page, "/library");
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  const playing = page.locator(".tr").nth(25);
  const title = (await playing.locator(".name").textContent()) ?? "";
  await playing.dblclick();
  await expect(bar(page).locator(".np-t")).toHaveText(title);
  const main = page.locator("#main");
  const pill = page.locator(".np-pill");
  await expect(pill).toBeHidden();

  await main.evaluate((el) => el.scrollTo(0, 0));
  await expect(pill).toHaveText(`Now playing · ${title}`);
  await pill.click();
  await expect(playing).toBeInViewport();
  await expect(pill).toBeHidden();

  await main.evaluate((el) => el.scrollTo(0, 0));
  await expect(pill).toBeVisible();
  await page.keyboard.press("Shift+L");
  await expect(playing).toBeInViewport();
  await expect(pill).toBeHidden();

  await main.evaluate((el) => el.scrollTo(0, 0));
  await expect(pill).toBeVisible();
  await bar(page)
    .getByRole("button", { name: `Show ${title} in the list` })
    .click();
  await expect(playing).toBeInViewport();
  await expect(pill).toBeHidden();
});
