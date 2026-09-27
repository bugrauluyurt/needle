import { expect, test } from "@playwright/test";
import { bar, openAlbum, playContext, position, signIn } from "./helpers.ts";

test("sees another device, controls it and moves playback across", async ({ browser }) => {
  const laptop = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const second = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signIn(laptop);
  await signIn(second);
  await second.goto("/settings");
  await second.getByLabel("Device name").fill("Kitchen speaker");
  await second.getByLabel("Device name").press("Enter");

  await openAlbum(laptop, "Blue Minutes");
  await playContext(laptop);
  await expect.poll(() => position(laptop)).toBeGreaterThanOrEqual(1);

  await second.goto("/");
  await bar(second).getByRole("button", { name: "Devices" }).click();
  const other = second.locator(".dev", { hasText: "Blue Minutes" });
  await expect(other).toContainText("Playing: Blue Minutes", { timeout: 15_000 });
  await other.getByRole("button", { name: /^Pause on / }).click();
  await expect(bar(laptop).getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect(other).toContainText("Paused: Blue Minutes");

  await other.getByRole("button", { name: "Play here" }).click();
  await expect(bar(second).locator(".np-t")).toHaveText("Blue Minutes", { timeout: 15_000 });
  await expect.poll(() => position(second), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  await expect(second.getByText(/Now playing here/)).toBeVisible();

  await laptop.close();
  await second.close();
});

test("offers to pick up where another device stopped", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await signIn(a);
  await openAlbum(a, "Pulse Theory");
  await playContext(a);
  await expect.poll(() => position(a)).toBeGreaterThanOrEqual(3);
  await a.locator("footer.bar").getByRole("button", { name: "Pause", exact: true }).click();
  await a.waitForTimeout(600);

  const b = await (await browser.newContext()).newPage();
  await signIn(b);
  await openAlbum(b, "Blue Minutes");
  await playContext(b);
  await b.waitForTimeout(6_500);
  await b.close();

  await a.goto("/");
  const card = a.getByRole("region", { name: "Pick up where you left off" });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText("Blue Minutes");
  await card.getByRole("button", { name: "Resume here" }).click();
  await expect(bar(a).locator(".np-t")).toHaveText("Blue Minutes");
  await a.close();
});
