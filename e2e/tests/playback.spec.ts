import { expect, test } from "@playwright/test";
import { bar, clickBody, openAlbum, playContext, position, signIn } from "./helpers.ts";

test("plays an album and moves through it", async ({ page }) => {
  await signIn(page);
  await openAlbum(page, "Afterglow Avenue");
  await playContext(page);
  await expect(bar(page).locator(".np-t")).toHaveText("Afterglow Avenue");
  await expect.poll(() => position(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".tr.playing .name")).toHaveText("Afterglow Avenue");
  await expect(bar(page).locator(".fmt")).toHaveText(/FLAC \d+\/44\.1/);

  await bar(page).getByRole("button", { name: "Next" }).click();
  await expect(bar(page).locator(".np-t")).toHaveText("Chrome Horizon");
  await bar(page).getByRole("button", { name: "Previous" }).click();
  await expect(bar(page).locator(".np-t")).toHaveText("Afterglow Avenue");

  await clickBody(page);
  await page.keyboard.press("Space");
  await expect(bar(page).getByRole("button", { name: "Play", exact: true })).toBeVisible();
  const paused = await position(page);
  await page.waitForTimeout(1500);
  expect(await position(page)).toBe(paused);
  await page.keyboard.press("Space");
  await expect(bar(page).getByRole("button", { name: "Pause", exact: true })).toBeVisible();
});

test("seeks, shuffles, repeats and changes volume", async ({ page }) => {
  await signIn(page);
  await openAlbum(page, "Weightless Hours");
  await playContext(page);
  await expect.poll(() => position(page)).toBeGreaterThanOrEqual(1);

  const seek = bar(page).getByRole("slider", { name: "Seek" });
  await seek.focus();
  await page.keyboard.press("End");
  await expect.poll(() => position(page)).toBeGreaterThan(55);
  await expect(bar(page).locator(".np-t")).toHaveText("Slow Tide", { timeout: 10_000 });

  const shuffle = bar(page).getByRole("button", { name: "Shuffle" });
  await shuffle.click();
  await expect(bar(page).getByRole("button", { name: "Turn off shuffle" })).toHaveAttribute("aria-pressed", "true");
  await bar(page).getByRole("button", { name: "Repeat" }).click();
  await expect(bar(page).getByRole("button", { name: "Repeat one" })).toBeVisible();
  await bar(page).getByRole("button", { name: "Repeat one" }).click();
  await expect(bar(page).getByRole("button", { name: "Turn off repeat" })).toBeVisible();

  const volume = bar(page).getByRole("slider", { name: "Volume" });
  await volume.focus();
  await page.keyboard.press("Home");
  await expect(volume).toHaveAttribute("aria-valuetext", "0%");
  await expect(bar(page).getByRole("button", { name: "Unmute" })).toBeVisible();
});

test("remembers the queue and position after a reload", async ({ page }) => {
  await signIn(page);
  await openAlbum(page, "Blue Minutes");
  await playContext(page);
  await expect.poll(() => position(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(6);
  await clickBody(page);
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  await page.reload();
  await expect(bar(page).locator(".np-t")).toHaveText("Blue Minutes");
  expect(await position(page)).toBeGreaterThanOrEqual(5);
  await bar(page).getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => position(page)).toBeGreaterThanOrEqual(7);
});

test("queues songs from the menu and shows them in the queue", async ({ page }) => {
  await signIn(page);
  await openAlbum(page, "Pulse Theory");
  await playContext(page);
  await expect(bar(page).locator(".np-t")).toHaveText("Pulse Theory");

  await page.locator(".tr", { hasText: "Sidechain" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Play next" }).click();
  await page.locator(".tr", { hasText: "Afterparty" }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Add to queue" }).click();

  await bar(page).getByRole("button", { name: "Queue" }).click();
  const panel = page.getByRole("complementary", { name: "Queue" });
  await expect(panel.getByText("Next in queue")).toBeVisible();
  const next = panel.locator(".mini-text .t");
  await expect(next.nth(1)).toHaveText("Sidechain");
  await expect(next.nth(2)).toHaveText("Afterparty");

  await panel.getByRole("button", { name: "Remove Afterparty from queue" }).first().click();
  await expect(next.nth(2)).toHaveText("Four on the Floor");

  await bar(page).getByRole("button", { name: "Next" }).click();
  await expect(bar(page).locator(".np-t")).toHaveText("Sidechain");
});

test("keyboard shortcuts work and are listed", async ({ page }) => {
  await signIn(page);
  await openAlbum(page, "Night Transit");
  await playContext(page);
  await expect.poll(() => position(page)).toBeGreaterThanOrEqual(1);
  await clickBody(page);

  await page.keyboard.press("Shift+ArrowRight");
  await expect(bar(page).locator(".np-t")).toHaveText("Overpass");
  await page.keyboard.press("l");
  await expect(bar(page).getByRole("button", { name: "Remove from liked songs" })).toBeVisible();
  await page.keyboard.press("l");
  await expect(bar(page).getByRole("button", { name: "Add to liked songs" })).toBeVisible();

  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Play or pause")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.keyboard.press("f");
  await expect(page.getByRole("dialog", { name: "Full screen player" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Full screen player" })).toBeHidden();
});

test("explains icon buttons with tooltips", async ({ page }) => {
  await signIn(page);
  await bar(page).getByRole("button", { name: "Queue" }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("QueueQ");
  await page.mouse.move(700, 450);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await bar(page).getByRole("button", { name: "Devices" }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("Devices");
});
