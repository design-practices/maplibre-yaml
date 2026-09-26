/**
 * Named `sources:` with `url:` — browser verification, which is also the demo.
 *
 * @remarks
 * The unit suite proves registerSources routes url-bearing geojson specs
 * through the DataFetcher; what only a browser proves is the user-visible
 * claim: a document whose layers reference a named remote source renders
 * features. Before the fix this exact shape aborted the whole render with no
 * console error — the gallery heatmap page shipped visibly empty (GH #88
 * review find), while every suite stayed green because the hermetic twins
 * used inline `data:`. This spec pins the load path itself.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGE = "/examples/verification/10-named-source-url.html";

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

test("a named source with url: fetches and both referencing layers draw from it", async ({
  page,
}) => {
  const errors = await guard(page);
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });

  // Both document layers exist — before the fix, registration threw and
  // neither layer (nor the source) was ever added.
  await page.waitForFunction(
    () => {
      const map = (document.getElementById("map") as any)?.getMap?.();
      if (!map || !map.isStyleLoaded?.()) return false;
      return (
        Boolean(map.getSource?.("quakes")) &&
        ["quakes-heat", "quakes-points"].every((id) => Boolean(map.getLayer?.(id)))
      );
    },
    undefined,
    { timeout: 60_000 }
  );

  // The fetch resolved into real rendered features, not just an empty
  // placeholder source.
  await page.waitForFunction(
    () => {
      const map = (document.getElementById("map") as any)?.getMap?.();
      return (
        (map?.queryRenderedFeatures?.(undefined, { layers: ["quakes-points"] }) ?? [])
          .length > 0
      );
    },
    undefined,
    { timeout: 30_000 }
  );

  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});
