import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export const USER = "admin";
export const PASSWORD = "needle-test";

export async function signIn(page: Page, path = "/") {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("needle.installHintSeen", "1");
    } catch {
      return;
    }
  });
  await page.goto(path);
  await page.getByLabel("Username").fill(USER);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator("#main")).toBeVisible();
}

export const bar = (page: Page) => page.locator("footer.bar");

export async function position(page: Page): Promise<number> {
  const text = (await bar(page).locator(".time").first().textContent()) ?? "0:00";
  const [m, s] = text.split(":").map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
}

export async function openAlbum(page: Page, name: string) {
  await page.goto(`/search?q=${encodeURIComponent(name)}`);
  await page.locator(".card-link", { hasText: name }).first().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

export async function clickBody(page: Page) {
  await page.mouse.click(700, 60);
}

export async function playContext(page: Page) {
  await page.locator(".actbar .bigplay").click();
}
