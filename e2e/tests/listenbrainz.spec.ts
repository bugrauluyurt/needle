import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { AUTH_HEADERS } from "@needle/shared";
import type { RequestItem, SongCandidate } from "@needle/shared";
import { expect, test } from "@playwright/test";
import { LB_TOKEN, LB_USER, UNDERTOW_MBID } from "../fixtures/listenbrainz.ts";
import { bar, PASSWORD, signIn, USER } from "./helpers.ts";

const NAVIDROME = "http://127.0.0.1:14533";
const NEEDLE = "http://127.0.0.1:14536";
const CLEANUP_SALT = "listenbrainz-cleanup";
const CLEANUP_AUTH_HEADERS = {
  [AUTH_HEADERS.user]: USER,
  [AUTH_HEADERS.token]: createHash("md5")
    .update(PASSWORD + CLEANUP_SALT)
    .digest("hex"),
  [AUTH_HEADERS.salt]: CLEANUP_SALT,
};

function navidromeUrl(method: string, parameters: Record<string, string> = {}): string {
  return `${NAVIDROME}/rest/${method}.view?${new URLSearchParams({
    u: USER,
    p: PASSWORD,
    c: "e2e",
    v: "1.16.1",
    f: "json",
    ...parameters,
  })}`;
}

async function undertowCanBeRequested(): Promise<boolean> {
  const response = await fetch(`${NEEDLE}/api/songs/search?q=undertow`, { headers: CLEANUP_AUTH_HEADERS });
  if (!response.ok) return false;

  const candidates = (await response.json()) as SongCandidate[];

  return candidates.some(
    (songCandidate) => songCandidate.title === "Undertow" && songCandidate.artist === "Glass Harbor",
  );
}

async function getUndertowRequest(): Promise<RequestItem | undefined> {
  const response = await fetch(`${NEEDLE}/api/requests`, { headers: CLEANUP_AUTH_HEADERS });
  if (!response.ok) return undefined;

  const requestItems = (await response.json()) as RequestItem[];

  return requestItems.find((requestItem) => requestItem.kind === "song" && requestItem.ref === UNDERTOW_MBID);
}

test.afterEach(async () => {
  const undertowRequest = await getUndertowRequest();
  if (undertowRequest) {
    await fetch(`${NEEDLE}/api/requests/${undertowRequest.id}`, {
      method: "DELETE",
      headers: CLEANUP_AUTH_HEADERS,
    });
  }

  await expect.poll(getUndertowRequest, { timeout: 5_000 }).toBeUndefined();

  await rm(join(import.meta.dirname, "../.singles/Glass Harbor/Glass Harbor - Undertow.flac"), { force: true });
  await fetch(navidromeUrl("startScan", { fullScan: "true" }));
  await expect.poll(undertowCanBeRequested, { timeout: 20_000 }).toBe(true);
});

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
  await page
    .locator(".toast", { hasText: "Saved 4 songs as a playlist" })
    .getByRole("button", { name: "Open" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: /Weekly Exploration/ })).toBeVisible();
  await expect(page.locator(".tr")).toHaveCount(4);

  await page.goto("/settings");
  await page.locator(".set-row", { hasText: "Connected as" }).getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByLabel("ListenBrainz user token")).toBeVisible();
});
