import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { signIn } from "./helpers.ts";

async function expectFullWidthViewport(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.visualViewport?.scale ?? 0)).toBeCloseTo(1, 3);

  const viewportDimensions = await page.evaluate(() => ({
    visibleWidth: window.visualViewport?.width ?? 0,
    layoutWidth: document.documentElement.clientWidth,
    contentWidth: document.documentElement.scrollWidth,
  }));

  expect(Math.abs(viewportDimensions.visibleWidth - viewportDimensions.layoutWidth)).toBeLessThanOrEqual(1);
  expect(viewportDimensions.contentWidth).toBeLessThanOrEqual(viewportDimensions.layoutWidth + 1);
}

async function gestureCancellationState(page: Page) {
  return page.evaluate(() => {
    const gestureStart = new Event("gesturestart", { bubbles: true, cancelable: true });
    const gestureChange = new Event("gesturechange", { bubbles: true, cancelable: true });
    const touchMove = new Event("touchmove", { bubbles: true, cancelable: true });

    document.dispatchEvent(gestureStart);
    document.dispatchEvent(gestureChange);
    document.dispatchEvent(touchMove);

    return {
      gestureStart: gestureStart.defaultPrevented,
      gestureChange: gestureChange.defaultPrevented,
      touchMove: touchMove.defaultPrevented,
    };
  });
}

test("keeps mobile browser zoom available without focusing or enlarging login fields", async ({ page }) => {
  await page.goto("/");

  const usernameInput = page.getByLabel("Username");
  const passwordInput = page.getByLabel("Password");
  const viewportMeta = page.locator('meta[name="viewport"]');

  await expect(page.getByRole("heading", { name: "Sign in to your music" })).toBeVisible();
  await expect(usernameInput).not.toBeFocused();
  await expect(usernameInput).toHaveCSS("font-size", "16px");
  await expect(passwordInput).toHaveCSS("font-size", "16px");
  await expect(viewportMeta).toHaveAttribute("content", "width=device-width, initial-scale=1, viewport-fit=cover");
  await expect(page.locator("html")).toHaveCSS("touch-action", "auto");

  expect(await gestureCancellationState(page)).toEqual({ gestureStart: false, gestureChange: false, touchMove: false });

  await usernameInput.focus();
  await expectFullWidthViewport(page);
  await passwordInput.focus();
  await expectFullWidthViewport(page);
});

test("keeps an installed mobile app at full width through focus, rotation and relaunch", async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { get: () => true });
  });

  await page.goto("/");

  const usernameInput = page.getByLabel("Username");
  const passwordInput = page.getByLabel("Password");

  await expect(page.getByRole("heading", { name: "Sign in to your music" })).toBeVisible();
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    "content",
    "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
  );
  await expect(page.locator("html")).toHaveCSS("touch-action", "pan-x pan-y");
  await expect(usernameInput).not.toBeFocused();
  await expect(usernameInput).toHaveCSS("font-size", "16px");
  await expect(passwordInput).toHaveCSS("font-size", "16px");

  expect(await gestureCancellationState(page)).toEqual({ gestureStart: true, gestureChange: true, touchMove: false });

  await expectFullWidthViewport(page);
  await usernameInput.focus();
  await expectFullWidthViewport(page);
  await passwordInput.focus();
  await expectFullWidthViewport(page);
  await passwordInput.blur();

  await page.setViewportSize({ width: 844, height: 390 });
  await expectFullWidthViewport(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectFullWidthViewport(page);

  await signIn(page, "/settings");
  await expect(page.getByLabel("Device name")).toHaveCSS("font-size", "16px");
  await expect(page.getByRole("slider")).toHaveCSS("touch-action", "none");
  await expect(page.locator("#main")).toHaveCSS("touch-action", "pan-x pan-y");
  await expect(page.locator("#main")).toHaveCSS("overflow-y", "auto");
  await expectFullWidthViewport(page);

  await page.close();

  const reopenedPage = await context.newPage();

  await reopenedPage.goto("/settings");
  await expect(reopenedPage.locator("#main")).toBeVisible();
  await expect(reopenedPage.locator("html")).toHaveCSS("touch-action", "pan-x pan-y");
  await expectFullWidthViewport(reopenedPage);
});
