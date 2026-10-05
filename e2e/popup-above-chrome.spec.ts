/**
 * Popups above chrome (ml-3d0) — browser verification, which is also the demo.
 *
 * @remarks
 * The unit test proves `liftPopup` sets the z-index; only a browser proves the
 * user-visible claim: where a popup and a chrome corner overlap, the POPUP is
 * what's on top. The test first asserts the two genuinely overlap (so it can't
 * pass vacuously if the layout shifts), then hit-tests the overlap.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGE = "/examples/verification/13-popup-above-chrome.html";

async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) {
      return route.continue();
    }
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

test("a popup opened under a chrome corner renders above it", async ({ page }) => {
  const errors = await guard(page);
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      document.querySelector(".maplibregl-popup") !== null &&
      document.querySelector(".ml-map-chrome-top-right") !== null,
    undefined,
    { timeout: 60_000 }
  );

  const hit = await page.evaluate(() => {
    const popup = document.querySelector(".maplibregl-popup-content")!.getBoundingClientRect();
    const panel = document.querySelector(".ml-map-chrome-top-right")!.getBoundingClientRect();
    const left = Math.max(popup.left, panel.left);
    const right = Math.min(popup.right, panel.right);
    const top = Math.max(popup.top, panel.top);
    const bottom = Math.min(popup.bottom, panel.bottom);
    if (right - left < 4 || bottom - top < 4) return { overlap: false };
    const x = (left + right) / 2;
    const y = (top + bottom) / 2;
    const el = document.elementFromPoint(x, y);
    return {
      overlap: true,
      popupOnTop: !!el?.closest(".maplibregl-popup"),
      chromeOnTop: !!el?.closest(".ml-map-chrome"),
      zIndex: getComputedStyle(document.querySelector(".maplibregl-popup")!).zIndex,
    };
  });

  expect(hit.overlap, "fixture drifted: the popup no longer overlaps the panel").toBe(true);
  expect(hit.popupOnTop, `popup is not on top (z-index ${hit.zIndex})`).toBe(true);
  expect(hit.chromeOnTop).toBe(false);
  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});
