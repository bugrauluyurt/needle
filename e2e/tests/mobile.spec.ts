import { expect, test } from "@playwright/test";
import { signIn, USER } from "./helpers.ts";
import { mockSpotify } from "./spotify-mock.ts";

test("moves between tabs and plays from the mini player", async ({ page }) => {
  await signIn(page);
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(tabs.getByRole("link", { name: "Home" })).toHaveClass(/on/);
  await tabs.getByRole("link", { name: "Library" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Your library" })).toBeVisible();
  await page.locator(".lib-item", { hasText: "Late night drive" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Late night drive" })).toBeVisible();
  await page.locator(".tr").first().tap();
  const mini = page.locator(".miniplayer");
  await expect(mini).toBeVisible();

  await mini.getByRole("button", { name: "Open now playing" }).tap();
  const sheet = page.getByRole("dialog", { name: "Now playing" });
  await expect(sheet.getByText("Playing from playlist")).toBeVisible();
  await sheet.getByRole("button", { name: "Next" }).tap();
  await sheet.getByRole("button", { name: "Queue" }).tap();
  await expect(sheet.getByRole("heading", { name: "Now playing", exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).tap();
  await sheet.getByRole("button", { name: "Open lyrics" }).tap();
  await expect(sheet.locator(".lyrics")).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).tap();
  await sheet.getByRole("button", { name: "Close" }).tap();
  await expect(sheet).toBeHidden();
});

test("song options open as a sheet, and Go to album minimizes the player", async ({ page }) => {
  await signIn(page, "/library");
  await page.locator(".lib-item", { hasText: "Late night drive" }).click();
  await page.locator(".tr").first().tap();
  await page.locator(".miniplayer").getByRole("button", { name: "Open now playing" }).tap();
  const player = page.getByRole("dialog", { name: "Now playing" });
  const moreOptionsButton = player.getByRole("button", { name: "More options" });

  await moreOptionsButton.tap();

  const sheet = page.locator(".action-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(moreOptionsButton).toBeFocused();
  await moreOptionsButton.tap();
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".as-quick button")).toHaveText(["Add to queue", "Play next", /Like/]);
  await sheet.getByRole("button", { name: "Add to playlist" }).tap();
  await expect(sheet.getByRole("textbox", { name: "Find a playlist" })).toBeVisible();
  await sheet.getByRole("button", { name: "Back" }).tap();
  await sheet.getByRole("button", { name: "Go to album" }).tap();

  await expect(sheet).toBeHidden();
  await expect(player).toBeHidden();
  await expect(page).toHaveURL(/\/album\//);
});

test("now playing links to the album and artist and closes during navigation", async ({ page }) => {
  await signIn(page, "/library");
  await page.locator(".lib-item", { hasText: "Late night drive" }).click();
  await page.locator(".tr").first().tap();

  const miniPlayer = page.locator(".miniplayer");
  const playerSheet = page.getByRole("dialog", { name: "Now playing" });
  await miniPlayer.getByRole("button", { name: "Open now playing" }).tap();

  const albumLink = playerSheet.locator(".ti h2").getByRole("link");
  await expect(albumLink).toHaveAttribute("href", /^\/album\//);
  await albumLink.tap();
  await expect(page).toHaveURL(/\/album\//);
  await expect(page.getByRole("heading", { level: 1, name: "İstanbul'da Gece" })).toBeVisible();
  await expect(playerSheet).toHaveCount(0);

  await miniPlayer.getByRole("button", { name: "Open now playing" }).tap();
  const artistLink = playerSheet.locator(".ti p").getByRole("link");
  await expect(artistLink).toHaveAttribute("href", /^\/artist\//);
  await artistLink.tap();
  await expect(page).toHaveURL(/\/artist\//);
  await expect(page.getByRole("heading", { level: 1, name: "Kasa Kaan" })).toBeVisible();
  await expect(playerSheet).toHaveCount(0);
});

test("searches with the mobile search box", async ({ page }) => {
  await signIn(page, "/search");
  await page.getByRole("searchbox", { name: "Search", exact: true }).fill("okto");
  await expect(page.locator(".top-card h2")).toHaveText("Okto Quartet");
});

test("keeps release-date sorting available when phone rows hide metadata", async ({ page }) => {
  await signIn(page, "/search?q=neon");
  await page.getByRole("button", { name: "Show all Songs in your library", exact: true }).tap();
  await page.getByRole("button", { name: /^Sort: Most relevant/ }).tap();
  await page.getByRole("menuitemradio", { name: "Release date", exact: true }).tap();
  await expect(page.getByRole("button", { name: /^Sort: Release date, descending/ })).toBeVisible();
  await expect(page.locator(".tr").first()).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toHaveCSS("font-size", "16px");
  expect(
    await page.locator("#main").evaluate((mainElement) => mainElement.scrollWidth <= mainElement.clientWidth),
  ).toBe(true);
});

test("animates caret dismissal and honors reduced motion without stopping playback", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await signIn(page, "/library");
  await page.locator(".lib-item", { hasText: "Late night drive" }).click();
  await page.locator(".tr").first().tap();
  const miniPlayer = page.locator(".miniplayer");
  await miniPlayer.getByRole("button", { name: "Open now playing" }).tap();
  const playerSheet = page.getByRole("dialog", { name: "Now playing" });
  await expect(playerSheet.locator("h2")).toHaveCSS("font-size", "27px");
  await expect(playerSheet).toHaveCSS("transform", "none");
  await playerSheet.getByRole("button", { name: "Close", exact: true }).tap();
  await expect(playerSheet).toHaveAttribute("data-state", "closed");
  await expect(playerSheet).toBeAttached();
  await expect(playerSheet).toHaveCount(0);
  await expect(miniPlayer.getByRole("button", { name: "Pause", exact: true })).toBeVisible();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await miniPlayer.getByRole("button", { name: "Open now playing" }).tap();
  await expect(playerSheet).toBeVisible();
  await playerSheet.getByRole("button", { name: "Close", exact: true }).tap();
  await expect(playerSheet).toHaveCount(0);
  await expect(miniPlayer.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
});

test("follows a downward gesture, settles a partial drag and animates swipe dismissal", async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await signIn(page, "/library");
  await page.locator(".lib-item", { hasText: "Late night drive" }).click();
  await page.locator(".tr").first().tap();
  await page.locator(".miniplayer").getByRole("button", { name: "Open now playing" }).tap();
  const playerSheet = page.getByRole("dialog", { name: "Now playing" });
  await expect(playerSheet).toHaveCSS("transform", "none");
  const albumArtBounds = await playerSheet.locator(".nowp-art").boundingBox();

  if (!albumArtBounds) throw new Error("Now playing artwork is unavailable");

  const touchPoint = { x: albumArtBounds.x + albumArtBounds.width / 2, y: albumArtBounds.y + 50 };
  const touchSession = await context.newCDPSession(page);
  await touchSession.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint] });
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...touchPoint, y: touchPoint.y + 30 }],
  });
  await expect
    .poll(() =>
      playerSheet.evaluate((sheetElement) => new DOMMatrixReadOnly(getComputedStyle(sheetElement).transform).m42),
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(150);
  await touchSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(playerSheet).toHaveCSS("transform", "none");
  await expect(playerSheet).toBeVisible();

  await touchSession.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint] });
  await touchSession.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...touchPoint, y: touchPoint.y + 300 }],
  });
  await touchSession.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(playerSheet).toHaveAttribute("data-state", "closed");
  await expect(playerSheet).toBeAttached();
  await expect(playerSheet).toHaveCount(0);
  await expect(page.locator(".miniplayer").getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await touchSession.detach();
});

test("the search button opens Search with the field focused", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Search", exact: true }).tap();
  await expect(page).toHaveURL(/\/search/);
  await expect(page.getByRole("searchbox", { name: "Search", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Search", exact: true })).toHaveCount(0);
});

test("shows the You tab with install steps for iPhone", async ({ page }) => {
  await signIn(page, "/you");
  await expect(page.getByText("Put Needle on your home screen")).toBeVisible();
  await page.getByRole("link", { name: /Your listening/ }).tap();
  await expect(page.locator(".stat-lede")).toContainText(/\d+(?:\.\d+)? (?:minutes?|hours?) of music/);
});

test("hides keyboard shortcuts from mobile settings and the account menu", async ({ page }) => {
  await signIn(page, "/settings");
  await expect(page.getByRole("heading", { name: "Playback" })).toBeVisible();
  await expect(page.locator(".set-row", { hasText: "Keyboard shortcuts" })).toHaveCount(0);

  await page.getByRole("button", { name: /^Account, signed in as/ }).tap();
  await expect(page.getByRole("menuitem", { name: "Keyboard shortcuts" })).toHaveCount(0);
});

for (const [path, label] of [
  ["/search?focus", "Search"],
  ["/library", "Search in your library"],
]) {
  test(`submitting ${label} dismisses focus and preserves delayed results`, async ({ page }) => {
    await signIn(page, path);
    const search = page.getByRole("searchbox", { name: label, exact: true });
    await search.fill("neon");
    await search.press("Enter");
    await expect(search).not.toBeFocused();
    await expect(search).toHaveValue("neon");
    await expect(page.locator(".top-card h2")).toHaveText("Neon Harbor");
    await expect(search).not.toBeFocused();
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
  });
}

test("mobile inline filters dismiss focus without a commit callback", async ({ page }) => {
  await signIn(page, "/library");
  await page.locator(".lib-item", { hasText: "Late night drive" }).click();
  await page.getByRole("button", { name: "Find in playlist", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Find in playlist", exact: true });
  await search.fill("neon");
  await search.press("Enter");
  await expect(search).not.toBeFocused();
  await expect(search).toHaveValue("neon");
  await expect(page.locator(".tr").first()).toBeVisible();
});

test("composition confirmation keeps mobile search focused and does not commit", async ({ page }) => {
  await signIn(page, "/search");
  const search = page.getByRole("searchbox", { name: "Search", exact: true });
  await search.fill("neon");
  await search.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await expect(search).toBeFocused();
  await search.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229 });
  await expect(search).toBeFocused();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Browse your library" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent searches" })).toHaveCount(0);
});

test("mobile Spotify remains connected with a visible cooldown notice", async ({ page }) => {
  await mockSpotify(page);
  let calls = 0;
  page.on("request", (request) => {
    if (request.url().startsWith("https://api.spotify.com/") || request.url().startsWith("https://sdk.scdn.co/"))
      calls += 1;
  });
  await signIn(page);
  const callsBeforeCooldown = calls;

  await page.evaluate((accountUser) => {
    localStorage.setItem(
      `needle.spotifyBlockedUntil.${encodeURIComponent(accountUser)}`,
      String(Date.now() + 3_600_000),
    );
  }, USER);
  await page.goto("/search?q=glass");
  await expect(page.getByRole("status", { name: "Spotify status" })).toBeVisible();
  await expect(page.getByRole("region", { name: "On Spotify", exact: true })).toContainText("Search will resume");
  expect(await page.locator("#main").evaluate((main) => main.scrollWidth <= main.clientWidth)).toBe(true);
  expect(calls).toBe(callsBeforeCooldown);
});

test("separates a locked Spotify playlist note from its description", async ({ page }) => {
  await mockSpotify(page);
  await signIn(page, "/spotify/playlist/p2");

  await expect(page.locator(".sp-note")).toHaveCSS("padding-top", "24px");
});
