/**
 * Background layer — browser verification, which is also the demo.
 *
 * @remarks
 * The unit suite proves addLayer skips source resolution for background
 * layers; what only a browser proves is the document-level claim: a
 * schema-valid background layer renders AND the layers after it still
 * render (before ml-chf the whole document died on the throw). Found by
 * the ml-chh.1 examples-gallery triage.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGE = "/examples/verification/11-background-layer.html";

/** Fail the test on any page error or off-origin request (hermeticity). */
async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || url.startsWith("data:")) {
      return route.continue();
    }
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

test("a background layer renders and the document survives it", async ({ page }) => {
  const errors = await guard(page);
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });

  await page.waitForFunction(
    () => {
      const map = (document.getElementById("map") as any)?.getMap?.();
      if (!map || !map.isStyleLoaded?.()) return false;
      return ["wash", "marker"].every((id) => Boolean(map.getLayer?.(id)));
    },
    undefined,
    { timeout: 60_000 }
  );

  // The circle AFTER the background layer put real features on screen —
  // the document did not die at the background layer.
  await page.waitForFunction(
    () => {
      const map = (document.getElementById("map") as any)?.getMap?.();
      return (
        (map?.queryRenderedFeatures?.(undefined, { layers: ["marker"] }) ?? []).length > 0
      );
    },
    undefined,
    { timeout: 30_000 }
  );

  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});
