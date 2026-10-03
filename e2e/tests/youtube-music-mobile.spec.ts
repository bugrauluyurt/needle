import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";
import { mockYouTubeMusic } from "./youtube-music-mock.ts";

test("plays YouTube music on the phone and keeps source actions in the song sheet", async ({ page }) => {
  await mockYouTubeMusic(page);
  const musicBytes = await readFile(
    new URL("../.library/Neon Harbor/Night Transit (2022)/01 - Night Transit.mp3", import.meta.url),
  );

  await page.route("**/youtube-music/stream/**", (route) =>
    route.fulfill({ body: musicBytes, contentType: "audio/mpeg" }),
  );
  await signIn(page, "/youtube-music/album/MPRE_album");
  await page.locator(".tr").first().tap();

  const miniPlayer = page.locator(".miniplayer");

  await expect(miniPlayer.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await miniPlayer.getByRole("button", { name: "Open now playing", exact: true }).tap();

  const playerSheet = page.getByRole("dialog", { name: "Now playing", exact: true });

  await expect(playerSheet.getByRole("img", { name: "From YouTube Music", exact: true })).toBeVisible();

  await expect
    .poll(() =>
      playerSheet.locator(".ti p").evaluate((artistLine) => {
        const sourceIcon = artistLine.querySelector('[role="img"]');
        const artistLink = artistLine.querySelector("a");

        return sourceIcon && artistLink
          ? artistLink.getBoundingClientRect().left - sourceIcon.getBoundingClientRect().right
          : 0;
      }),
    )
    .toBeGreaterThanOrEqual(6);

  await playerSheet.getByRole("button", { name: "More options", exact: true }).tap();

  const actionSheet = page.locator(".action-sheet");

  await expect(actionSheet).toBeVisible();
  await expect(actionSheet.getByRole("button", { name: "Add to playlist", exact: true })).toHaveCount(0);
  await expect(actionSheet.getByRole("button", { name: "Open in YouTube Music", exact: true })).toBeVisible();
  expect(
    await page.locator("#main").evaluate((mainElement) => mainElement.scrollWidth <= mainElement.clientWidth),
  ).toBe(true);
});
