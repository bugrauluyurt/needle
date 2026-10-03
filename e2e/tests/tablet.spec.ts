import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { bar, clickBody, openAlbum, playContext, signIn } from "./helpers.ts";

async function playAlbum(page: Page, name: string) {
  await signIn(page);
  await openAlbum(page, name);
  await playContext(page);
  await expect(bar(page).locator(".np-t")).toHaveText(name);
}

test("keeps the library's sort menu and list titles in the rail layout", async ({ page }) => {
  await signIn(page, "/library");
  const library = page.locator(".library-page");
  const sort = library.getByRole("button", { name: /^(Show and sort|Sort):/ });
  await expect(sort).toBeVisible();
  await sort.click();
  await page.getByRole("menuitemradio", { name: "List", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(library.locator(".lib-item .t", { hasText: "Liked songs" })).toBeVisible();
  await expect(library.locator(".lib-item .s").first()).toBeVisible();
});

test("names the rail's links and explains them with tooltips", async ({ page }) => {
  await signIn(page);
  const side = page.locator(".side");
  await expect(side.getByRole("link", { name: "Search", exact: true })).toBeVisible();
  await side.getByRole("link", { name: "Your listening" }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("Your listening");
  await side.locator(".lib-item").first().hover();
  await expect(page.getByRole("tooltip")).toHaveText(/^Liked songs/);
});

test("aligns sidebar icons and labels at desktop widths", async ({ page }) => {
  await signIn(page);

  const sidebar = page.locator(".side");
  const sidebarLinks = [
    sidebar.getByRole("link", { name: "Needle home", exact: true }),
    sidebar.getByRole("link", { name: "Home", exact: true }),
    sidebar.getByRole("link", { name: "Search", exact: true }),
    sidebar.getByRole("link", { name: "Your listening", exact: true }),
    sidebar.getByRole("link", { name: "Radio", exact: true }),
    sidebar.getByRole("link", { name: "Your library", exact: true }),
  ];

  for (const viewportWidth of [1024, 1180, 1440]) {
    await page.setViewportSize({ width: viewportWidth, height: 1000 });
    const iconCenterXs: number[] = [];
    const labelLeftXs: number[] = [];

    for (const sidebarLink of sidebarLinks) {
      const iconBounds = await sidebarLink.locator("svg").evaluate((iconElement) => {
        const iconRect = iconElement.getBoundingClientRect();

        return { centerX: iconRect.x + iconRect.width / 2, centerY: iconRect.y + iconRect.height / 2 };
      });
      const labelBounds = await sidebarLink.locator("span").evaluate((labelElement) => {
        const labelRect = labelElement.getBoundingClientRect();

        return { left: labelRect.x, centerY: labelRect.y + labelRect.height / 2 };
      });

      iconCenterXs.push(iconBounds.centerX);
      labelLeftXs.push(labelBounds.left);
      expect(Math.abs(iconBounds.centerY - labelBounds.centerY), `icon and label at ${viewportWidth}px`).toBeLessThanOrEqual(1);
    }

    expect(Math.max(...iconCenterXs) - Math.min(...iconCenterXs), `icon centers at ${viewportWidth}px`).toBeLessThanOrEqual(1);
    expect(Math.max(...labelLeftXs) - Math.min(...labelLeftXs), `label edges at ${viewportWidth}px`).toBeLessThanOrEqual(1);
    await expect(sidebar.getByRole("link", { name: "Needle home", exact: true }).locator("svg")).toHaveCSS("width", "42px");
  }
});

test("hides duplicate library actions and centers navigation in the medium rail", async ({ page }) => {
  await signIn(page);

  const side = page.locator(".side");
  const primarySearch = side.getByRole("link", { name: "Search", exact: true });
  const librarySearch = side.getByRole("button", { name: "Search in your library" });
  const createPlaylist = side.getByRole("button", { name: "Create playlist" });
  const needleLogo = side.getByRole("link", { name: "Needle home", exact: true }).locator("svg");
  const railLinks = [
    side.getByRole("link", { name: "Needle home", exact: true }),
    side.getByRole("link", { name: "Home", exact: true }),
    primarySearch,
    side.getByRole("link", { name: "Your listening", exact: true }),
    side.getByRole("link", { name: "Radio", exact: true }),
    side.getByRole("link", { name: "Your library", exact: true }),
  ];

  for (const viewportWidth of [768, 900, 1023]) {
    await page.setViewportSize({ width: viewportWidth, height: 1000 });
    await expect(primarySearch).toBeVisible();
    await expect(librarySearch).toBeHidden();
    await expect(createPlaylist).toBeHidden();
    await expect(needleLogo).toHaveCSS("width", "42px");

    const sideBounds = await side.evaluate((sideElement) => {
      const sideRect = sideElement.getBoundingClientRect();

      return { centerX: sideRect.x + sideRect.width / 2 };
    });

    for (const railLink of railLinks) {
      const iconBounds = await railLink.locator("svg").evaluate((iconElement) => {
        const iconRect = iconElement.getBoundingClientRect();

        return { centerX: iconRect.x + iconRect.width / 2 };
      });

      expect(Math.abs(iconBounds.centerX - sideBounds.centerX), `rail icon at ${viewportWidth}px`).toBeLessThanOrEqual(1);
    }
  }

  await page.setViewportSize({ width: 1024, height: 1000 });
  await expect(librarySearch).toBeVisible();
  await expect(createPlaylist).toBeVisible();
});

test("fits the player bar's controls beside the seek bar", async ({ page }) => {
  await playAlbum(page, "Afterglow Avenue");
  for (const width of [768, 900, 1023]) {
    await page.setViewportSize({ width, height: 1000 });
    const seek = await bar(page).locator(".seek").boundingBox();
    const controls = await bar(page).locator(".bar-r > *").evaluateAll((els) => Math.min(...els.map((el) => el.getBoundingClientRect().left)));
    expect(seek, `seek bar at ${width}px`).not.toBeNull();
    expect(controls, `controls at ${width}px`).toBeGreaterThanOrEqual((seek?.x ?? 0) + (seek?.width ?? 0));
  }
  await bar(page).getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: "Lyrics" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Full screen" }).click();
  await expect(page.getByRole("dialog", { name: "Full screen player" })).toBeVisible();
  await page.keyboard.press("Escape");

  await bar(page).getByRole("button", { name: "Volume" }).click();
  const volume = page.getByRole("slider", { name: "Volume" });
  await expect(volume).toBeVisible();
  const before = await volume.getAttribute("aria-valuetext");
  await volume.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(volume).not.toHaveAttribute("aria-valuetext", before ?? "");
});

test("opens the queue as a panel over the page and closes it again", async ({ page }) => {
  await playAlbum(page, "Night Transit");
  await clickBody(page);
  await page.keyboard.press("q");
  const dialog = page.getByRole("dialog", { name: "Queue" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("complementary", { name: "Queue" }).getByText("Next from Night Transit")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  const queue = bar(page).getByRole("button", { name: "Queue" });
  await queue.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await page.mouse.click(200, 400);
  await expect(dialog).toBeHidden();
  await expect(queue).toBeFocused();

  await bar(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Now playing" }).click();
  await expect(page.getByRole("dialog", { name: "Night Transit" })).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await expect(bar(page).getByRole("button", { name: "More" })).toBeFocused();
});
