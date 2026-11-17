/**
 * interactive.click / hover `tolerance` (ml-tgg) — browser verification, which
 * is also the user demo.
 *
 * @remarks
 * The unit suite proves a `tolerance` swaps the delegated layer listener for a
 * map-level one that hit-tests a ±n px box. What only a real map proves is the
 * user-facing claim: a click or hover a few pixels BESIDE a 2 px line or a 3 px
 * dot opens its popup, sets its cursor and lights its highlight when the layer
 * has `tolerance: 8`, and does nothing on an identical layer without it. And
 * that a live document update which removes `tolerance` reverts the layer to
 * on-the-pixel behaviour (the listeners are re-bound in place).
 *
 * Fixture: examples/verification/interactive-tolerance.html — the left pair
 * (line-tolerant, dot-tolerant) carries `tolerance: 8`; the right pair
 * (line-plain, dot-plain) is identical without it.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGE = "/examples/verification/interactive-tolerance.html";
const OFF = 5; // px beside the feature: off its pixels, inside the 8 px slack
const FAR = 16; // px beside the feature: outside the slack too

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

/** Each feature's anchor, in lng/lat: a point ON the feature. */
const ANCHOR: Record<string, [number, number]> = {
  "line-tolerant": [-0.02, 0],
  "line-plain": [0.02, 0],
  "dot-tolerant": [-0.01, 0.02],
  "dot-plain": [0.01, 0.02],
};

/** Wait until a layer's feature is hit-testable at its anchor. */
async function waitForHittable(page: Page, layerId: string) {
  await page.waitForFunction(
    ({ layerId, anchor }) => {
      const el = document.querySelector("ml-map") as any;
      const map = el?.getMap?.();
      if (!map || !map.isStyleLoaded?.() || !map.getLayer?.(layerId)) return false;
      return map.queryRenderedFeatures(map.project(anchor), { layers: [layerId] }).length > 0;
    },
    { layerId, anchor: ANCHOR[layerId] },
    { timeout: 60_000 }
  );
}

/** Page coordinates `dx` px to the right of a feature's anchor. */
async function beside(page: Page, layerId: string, dx: number) {
  const box = (await page.locator("canvas.maplibregl-canvas").boundingBox())!;
  const p = await page.evaluate(
    (anchor) => {
      const pt = (document.querySelector("ml-map") as any).getMap().project(anchor);
      return { x: pt.x, y: pt.y };
    },
    ANCHOR[layerId]
  );
  return { x: box.x + Math.round(p.x) + dx, y: box.y + Math.round(p.y) };
}

/** The open popup's text, or "" when none is open. */
async function popupText(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector(".maplibregl-popup-content p")?.textContent?.trim() ?? ""
  );
}

async function clickBeside(page: Page, layerId: string, dx: number) {
  const at = await beside(page, layerId, dx);
  await page.mouse.click(at.x, at.y);
}

/** Click empty map (closes a pinned popup via closeOnClick) and park the pointer. */
async function reset(page: Page) {
  const box = (await page.locator("canvas.maplibregl-canvas").boundingBox())!;
  await page.mouse.click(box.x + 30, box.y + box.height - 30);
  await expect.poll(() => popupText(page)).toBe("");
}

async function cursor(page: Page): Promise<string> {
  return page.evaluate(
    () => (document.querySelector("ml-map") as any).getMap().getCanvas().style.cursor
  );
}

/** The `hover` feature-state of a layer's feature (its inline source is `${id}-source`). */
async function hoverState(page: Page, layerId: string): Promise<boolean | undefined> {
  return page.evaluate(
    ({ layerId, anchor }) => {
      const map = (document.querySelector("ml-map") as any).getMap();
      const f = map.queryRenderedFeatures(map.project(anchor), { layers: [layerId] })[0];
      return map.getFeatureState({ source: `${layerId}-source`, id: f.id }).hover;
    },
    { layerId, anchor: ANCHOR[layerId] }
  );
}

test.describe("interactive tolerance: pixels of slack around a feature", () => {
  test("click and hover 5 px beside a thin feature count with tolerance, not without; a live update removing it reverts", async ({
    page,
  }) => {
    const errors = await guard(page);
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    for (const id of Object.keys(ANCHOR)) await waitForHittable(page, id);

    // ---- Click: 5 px beside the tolerant line opens ITS popup -------------
    await clickBeside(page, "line-tolerant", OFF);
    await expect.poll(() => popupText(page)).toBe("tolerant line");
    await reset(page);

    // ... and beside the tolerant dot.
    await clickBeside(page, "dot-tolerant", OFF);
    await expect.poll(() => popupText(page)).toBe("tolerant dot");
    await reset(page);

    // The same 5 px beside the plain twins opens nothing ...
    await clickBeside(page, "line-plain", OFF);
    await clickBeside(page, "dot-plain", OFF);
    await page.waitForTimeout(500);
    expect(await popupText(page)).toBe("");

    // ... while an exact hit on the plain line still does (the delegated path is intact).
    await clickBeside(page, "line-plain", 0);
    await expect.poll(() => popupText(page)).toBe("plain line");
    await reset(page);

    // Beyond the slack (16 px) the tolerant line opens nothing either.
    await clickBeside(page, "line-tolerant", FAR);
    await page.waitForTimeout(500);
    expect(await popupText(page)).toBe("");

    // ---- Hover: 5 px beside the tolerant line sets cursor + highlight -----
    let at = await beside(page, "line-tolerant", OFF);
    await page.mouse.move(at.x, at.y);
    await expect.poll(() => cursor(page)).toBe("pointer");
    await expect.poll(() => hoverState(page, "line-tolerant")).toBe(true);

    // Leaving (far beside it) clears both.
    at = await beside(page, "line-tolerant", FAR + 40);
    await page.mouse.move(at.x, at.y);
    await expect.poll(() => cursor(page)).toBe("");
    await expect.poll(() => hoverState(page, "line-tolerant")).not.toBe(true);

    // 5 px beside the plain line: no cursor, no highlight.
    at = await beside(page, "line-plain", OFF);
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(500);
    expect(await cursor(page)).toBe("");
    expect(await hoverState(page, "line-plain")).not.toBe(true);

    // ---- Live update: removing `tolerance` reverts to on-the-pixel --------
    const result = await page.evaluate(() => (window as any).__dropTolerance());
    expect(result.outcome).toBe("applied");
    expect(result.summary.failures).toEqual([]);
    expect(result.summary.propertiesSet).toEqual(
      expect.arrayContaining([
        { layerId: "line-tolerant", property: "interactive" },
        { layerId: "dot-tolerant", property: "interactive" },
      ])
    );

    await clickBeside(page, "line-tolerant", OFF);
    await page.waitForTimeout(500);
    expect(await popupText(page)).toBe("");
    at = await beside(page, "line-tolerant", OFF);
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(300);
    expect(await cursor(page)).toBe("");

    // An exact hit still works after the re-bind.
    await clickBeside(page, "line-tolerant", 0);
    await expect.poll(() => popupText(page)).toBe("tolerant line");

    expect(errors).toEqual([]);
  });
});
