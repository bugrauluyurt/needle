import { expect, test } from "@playwright/test";
import { PASSWORD, signIn, USER } from "./helpers.ts";

test("explains a wrong password", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to your music" })).toBeVisible();
  await page.getByLabel("Username").fill(USER);
  await page.getByLabel("Password").fill(`${PASSWORD}-wrong`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("That username and password don’t match a Navidrome account.");
});

test("signs in, stays signed in after a reload, and signs out", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening|night)/);
  await page.reload();
  await expect(page.locator("#main")).toBeVisible();
  await page.getByRole("button", { name: /Account, signed in as admin/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to your music" })).toBeVisible();
});

test("keeps the password out of storage", async ({ page }) => {
  await signIn(page);
  const stored = await page.evaluate(() => JSON.stringify(localStorage));
  expect(stored).not.toContain(PASSWORD);
  expect(stored).toContain("token");
});
