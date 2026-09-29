import { expect, test } from "@playwright/test";
import { LB_TOKEN, LB_USER } from "../fixtures/listenbrainz.ts";
import { bar, PASSWORD, signIn } from "./helpers.ts";

test("connects ListenBrainz, opens its weekly playlist, fetches the missing song and saves it", async ({ page }) => {
  await signIn(page, "/settings");
  await page.getByLabel("ListenBrainz user token").fill(LB_TOKEN);
  await page.getByLabel("Navidrome password (optional)").fill(PASSWORD);
  await page.getByRole("button", { name: "Connect ListenBrainz" }).click();
  await expect(page.getByText(`Connected as ${LB_USER}`)).toBeVisible();
  await expect(page.getByText("Navidrome sends them")).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Made for you by ListenBrainz" })).toBeVisible();
  const card = page.locator(".card", { hasText: "Weekly Exploration" });
  await expect(card).toContainText("4 in your library, 1 to get");
  await card.locator(".card-link").click();

  await expect(page.getByRole("heading", { level: 1, name: /Weekly Exploration/ })).toBeVisible();
  await expect(page.locator(".hero .kind")).toHaveText("Made for you by ListenBrainz");
  await expect(page.locator(".hero .meta")).toHaveText("5 songs, 4 in your library");
  await expect(page.locator(".hero .desc")).toContainText("songs you haven’t heard before");

  await page.locator(".tr", { hasText: "Galata" }).dblclick();
  await expect(bar(page).locator(".np-t")).toHaveText("Galata");

  const undertow = page.locator(".get-card", { hasText: "Undertow" });
  await expect(undertow).toContainText("Glass Harbor, Tidal, 3:32");
  await undertow.getByRole("button", { name: "Get song" }).click();
  await expect(undertow).toContainText("In your library", { timeout: 20_000 });

  await page.getByRole("button", { name: "Save as playlist" }).click();
  await page.locator(".toast", { hasText: "Saved 4 songs as a playlist" }).getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Weekly Exploration/ })).toBeVisible();
  await expect(page.locator(".tr")).toHaveCount(4);

  await page.goto("/settings");
  await page.locator(".set-row", { hasText: "Connected as" }).getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByLabel("ListenBrainz user token")).toBeVisible();
});
