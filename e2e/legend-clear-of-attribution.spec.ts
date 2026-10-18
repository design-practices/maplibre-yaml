/**
 * Bottom-left legend vs MapLibre's compact attribution (ml-aot.26) -- browser
 * verification, which is also the demo
 * (examples/verification/15-legend-clear-of-attribution.html).
 *
 * @remarks
 * On a phone-width map MapLibre's compact attribution starts expanded and
 * wraps across the map's bottom edge, over a bottom-left legend, until the
 * first drag. Only a browser shows the user-visible claim: at 390px the
 * legend's entries are hit-testable (nothing on top of them), and the (i)
 * button still expands the attribution on demand.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGE = "/examples/verification/15-legend-clear-of-attribution.html";

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

/** Is every legend item the topmost element at its own centre? */
const legendItemsOnTop = (page: Page) =>
  page.evaluate(() => {
    const items = [...document.querySelectorAll<HTMLElement>(".ml-map-legend .legend-item, .ml-map-legend [class*=item]")];
    return {
      count: items.length,
      covered: items
        .map((item) => {
          const r = item.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return top && (item.contains(top) || top.contains(item)) ? null : top?.className ?? "nothing";
        })
        .filter((x) => x !== null),
    };
  });

test.use({ viewport: { width: 390, height: 844 } });

test("a bottom-left legend is readable on a phone; the attribution starts collapsed", async ({ page }) => {
  const errors = await guard(page);
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      document.querySelector(".ml-map-legend") !== null &&
      document.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact") !== null,
    undefined,
    { timeout: 60_000 }
  );

  const legend = await legendItemsOnTop(page);
  expect(legend.count, "fixture drifted: no legend items found").toBeGreaterThan(0);
  expect(legend.covered, "legend items covered by").toEqual([]);
  const attrib = page.locator(".maplibregl-ctrl-attrib");
  await expect(attrib).not.toHaveClass(/maplibregl-compact-show/);

  // Still the user's to open: the (i) button expands it.
  await page.locator(".maplibregl-ctrl-attrib-button").click();
  await expect(attrib).toHaveClass(/maplibregl-compact-show/);
  await expect(attrib).toContainText("Example Volcano Survey");

  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});

test("a bottom-left scale bar (no bottom-left chrome) is readable on a phone (ml-aot.38)", async ({ page }) => {
  const errors = await guard(page);
  await page.goto("/examples/verification/16-scale-clear-of-attribution.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      document.querySelector(".maplibregl-ctrl-scale") !== null &&
      document.querySelector(".ml-map-legend") !== null &&
      document.querySelector(".maplibregl-ctrl-attrib.maplibregl-compact") !== null,
    undefined,
    { timeout: 60_000 }
  );
  await page.evaluate(() => (document.getElementById("map") as any).mapReady());
  const covered = await page.evaluate(() => {
    const scale = document.querySelector<HTMLElement>(".maplibregl-ctrl-scale")!;
    const r = scale.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top && (scale.contains(top) || top.contains(scale)) ? null : top?.className ?? "nothing";
  });
  expect(covered, "scale bar covered by").toBeNull();
  const attrib = page.locator(".maplibregl-ctrl-attrib");
  await expect(attrib).not.toHaveClass(/maplibregl-compact-show/);
  await page.screenshot({ path: "e2e/results/scale-clear-of-attribution-mob.png" });
  expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
});
