/**
 * A slow map says it is loading (ml-aot.121): on a slow connection the box
 * used to stay blank for seconds. The element is `aria-busy` while it
 * starts, a muted "Loading map…" appears once it has taken a second, and
 * both go when the basemap draws — on a plain map and on a story's map, and
 * whether or not the element is `quiet` (it is not a notice).
 *
 * The demo is any map whose basemap style is slow: the specs slow the local
 * style down with a route.
 */
import { test, expect, type Page } from "@playwright/test";

/** Hold the basemap style for `ms`. */
async function slowStyle(page: Page, ms: number) {
  await page.route("**/examples/verification/configs/local-style.json", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

test.describe("loading state", () => {
  test("a slow map: aria-busy, then 'Loading map…', both gone once it draws", async ({ page }) => {
    await slowStyle(page, 3000);
    await page.goto("/examples/verification/cloud-native/fit-framed.html", { waitUntil: "domcontentloaded" });
    const map = page.locator("#map");
    await expect(map).toHaveAttribute("aria-busy", "true");
    const label = page.locator("#map .ml-map-loading");
    await expect(label).toHaveText("Loading map…", { timeout: 2500 });
    await expect(label).toHaveAttribute("role", "status");
    await page.evaluate(() => (document.getElementById("map") as any).mapReady());
    await expect(label).toHaveCount(0);
    await expect(map).not.toHaveAttribute("aria-busy", /.*/);
  });

  test("a fast map never shows it", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__sawLoading = false;
      new MutationObserver(() => {
        if (document.querySelector(".ml-map-loading")) (window as any).__sawLoading = true;
      }).observe(document.documentElement, { childList: true, subtree: true });
    });
    await page.goto("/examples/verification/cloud-native/fit-framed.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => (document.getElementById("map") as any).mapReady());
    expect(await page.evaluate(() => (window as any).__sawLoading)).toBe(false);
  });

  test("quiet doesn't hide it; a story's map shows it too", async ({ page }) => {
    await slowStyle(page, 3000);
    await page.goto("/examples/verification/cloud-native/story.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#story ml-map .ml-map-loading")).toHaveText("Loading map…", { timeout: 2500 });
    await page.evaluate(() => (document.getElementById("story") as any).mapReady());
    await expect(page.locator("#story ml-map .ml-map-loading")).toHaveCount(0);

    await page.goto("/examples/verification/cloud-native/fit-framed.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.getElementById("map")!.setAttribute("quiet", ""));
    await expect(page.locator("#map .ml-map-loading")).toHaveText("Loading map…", { timeout: 2500 });
  });
});
