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

test("signs in, stays signed in after a same-tab reload, and signs out", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening|night)/);
  await page.reload();
  await expect(page.locator("#main")).toBeVisible();
  await page.getByRole("button", { name: /Account, signed in as admin/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to your music" })).toBeVisible();
});

test("stays signed in after closing and reopening the app", async ({ page, context }) => {
  await signIn(page);
  await page.close();

  const reopenedPage = await context.newPage();

  await reopenedPage.goto("/");
  await expect(reopenedPage.locator("#main")).toBeVisible();
  await expect(reopenedPage.getByRole("heading", { name: "Sign in to your music" })).toBeHidden();
});

test("stays signed out after closing and reopening the app", async ({ page, context }) => {
  await signIn(page);
  await page.getByRole("button", { name: /Account, signed in as admin/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to your music" })).toBeVisible();
  await page.close();

  const reopenedPage = await context.newPage();

  await reopenedPage.goto("/");
  await expect(reopenedPage.getByRole("heading", { name: "Sign in to your music" })).toBeVisible();
});

test("remembers the authentication token without storing the password", async ({ page }) => {
  await signIn(page);
  const persistentStorage = await page.evaluate(() => JSON.stringify(localStorage));
  const tabStorage = await page.evaluate(() => JSON.stringify(sessionStorage));

  expect(persistentStorage).not.toContain(PASSWORD);
  expect(persistentStorage).toContain("token");
  expect(tabStorage).not.toContain(PASSWORD);
  expect(tabStorage).not.toContain("token");
});
