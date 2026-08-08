/**
 * v0.6.0 interactions — browser verification, which is also the user demo.
 *
 * @remarks
 * The unit suites prove `projectInteractions` produces the right declarative
 * data and `attachInteractions` binds the right listeners. What only a real
 * browser proves is the epic's headline claim: interactions work end-to-end on a
 * map this library did NOT render — both a bare compiled `style.json` in vanilla
 * maplibre-gl and a host-constructed `Map` (the map-party shape) — with the
 * popup trust-gate holding.
 *
 * The same page a user opens to see the interactions story is the page this test
 * drives. One authored document is projected once and attached four ways:
 *
 *   - AE2: compiled map — click opens a popup, fits the feature, hover lights
 *     feature-state.
 *   - AE3: `emit` fires the host handler with the projected payload under a
 *     trusted policy; under untrusted the projection dropped it, so nothing fires.
 *   - AE5: the `!html` popup value and a `<script>` feature property render
 *     escaped under the untrusted policy.
 *   - AE6: the same interactions fire on a host-constructed map, and
 *     `handle.destroy()` detaches cleanly — a later event does nothing.
 *   - AE4: a projection naming an unknown interaction warns and binds no handler.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGE = "/examples/verification/interactions/compiled-interactions.html";

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

/** Wait until a map's layer is loaded and its features are hit-testable. */
async function waitForHittable(page: Page, mapKey: string, layerId: string) {
  await page.waitForFunction(
    ({ mapKey, layerId }) => {
      const map = (window as any).__demo?.maps?.[mapKey];
      if (!map || !map.isStyleLoaded?.() || !map.getLayer?.(layerId)) return false;
      const pt = map.project(map.getCenter());
      return map.queryRenderedFeatures(pt, { layers: [layerId] }).length > 0;
    },
    { mapKey, layerId },
    { timeout: 60_000 }
  );
}

/** Fire a delegated map event at the feature under the map's centre. */
async function fireAtCentre(page: Page, mapKey: string, type: "click" | "mousemove") {
  await page.evaluate(
    ({ mapKey, type }) => {
      const map = (window as any).__demo.maps[mapKey];
      const c = map.getCenter();
      map.fire(type, { lngLat: c, point: map.project(c) });
    },
    { mapKey, type }
  );
}

/** Read a map's open popup HTML, or "" when none is open. */
async function popupHtml(page: Page, containerId: string): Promise<string> {
  return page.evaluate((containerId) => {
    const el = document.querySelector(`#${containerId} .maplibregl-popup-content`);
    return el ? el.innerHTML : "";
  }, containerId);
}

test.describe("interactions attach to a map the library did not render", () => {
  test("compiled + host + untrusted + unknown-name, one projected document", async ({
    page,
  }) => {
    const errors = await guard(page);
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });

    // All four legs wired without throwing.
    await page.waitForFunction(
      () => (window as any).__demo?.ready === true || (window as any).__demo?.error,
      undefined,
      { timeout: 60_000 }
    );
    const demoError = await page.evaluate(() => (window as any).__demo.error);
    expect(demoError, `page reported: ${demoError}`).toBeNull();

    await waitForHittable(page, "compiled", "area");
    await waitForHittable(page, "host", "area");
    await waitForHittable(page, "untrusted", "area");

    // The compiled style really is a compiled style.json: version 8, the
    // basemap merged under the document's layers, and no runtime half.
    const style = await page.evaluate(() => (window as any).__demo.compiledStyle);
    expect(style.version).toBe(8);
    expect(style.layers.map((l: { id: string }) => l.id)).toEqual(["bg", "area", "dot"]);
    expect(JSON.stringify(style)).not.toContain("interactive");
    expect(JSON.stringify(style)).not.toContain("emit");

    // ---- AE4: an unknown interaction name warns and binds no handler --------
    // The warning fires synchronously at attach time, so it is present already.
    const warnings: string[] = await page.evaluate(() => (window as any).__demo.warnings);
    const denial = warnings.find(
      (w) => w.includes("doesNotExist") && w.includes("not a recognized interaction")
    );
    expect(denial, `warnings: ${JSON.stringify(warnings)}`).toBeTruthy();

    // ---- AE5 + AE3(untrusted): escape the popup, drop the host hook ---------
    await fireAtCentre(page, "untrusted", "click");
    const untrustedPopup = await popupHtml(page, "map-untrusted");
    // The authored `!html "<b>...</b>"` renders as escaped text, not live markup.
    expect(untrustedPopup).toContain("&lt;b&gt;Bold from !html&lt;/b&gt;");
    expect(untrustedPopup).not.toContain("<b>Bold from");
    // The `<script>`-bearing `name` property is escaped too — no live script tag.
    expect(untrustedPopup).not.toContain("<script");
    expect(untrustedPopup).toContain("&lt;script&gt;");
    // AE3, the untrusted half: `emit` was dropped at projection, so despite a
    // registered handler, nothing fired.
    const untrustedEmit = await page.evaluate(() => (window as any).__demo.untrustedEmit);
    expect(untrustedEmit, "untrusted emit must stay null (projection dropped it)").toBeNull();

    // ---- AE2: compiled map — hover lights state, click opens + fits + emits --
    const compiledCanvas = page.locator("#map-compiled canvas.maplibregl-canvas");
    const box = (await compiledCanvas.boundingBox())!;

    // Hover the feature at the quadrant's centre; assert its feature-state lit.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(600);
    const hoverState = await page.evaluate(() => {
      const map = (window as any).__demo.maps.compiled;
      const pt = map.project(map.getCenter());
      const f = map.queryRenderedFeatures(pt, { layers: ["area"] })[0];
      if (!f) return null;
      return map.getFeatureState({ source: "pts", id: f.id });
    });
    expect(hoverState, "hover.highlight did not set feature-state").toMatchObject({
      hover: true,
    });

    // Camera before the click, so we can prove zoomToFeature moved it.
    const before = await page.evaluate(() => (window as any).__demo.maps.compiled.getZoom());

    await fireAtCentre(page, "compiled", "click");
    await page.waitForTimeout(1200); // let the 300ms fitBounds flight finish

    // Popup opened on the compiled map, with the trusted `!html` live as markup.
    const compiledPopup = await popupHtml(page, "map-compiled");
    expect(compiledPopup).toContain("<b>Bold from !html</b>");
    // The feature property is still escaped — escaping is not a trust decision.
    expect(compiledPopup).not.toContain("<script");

    // The camera fit the clicked feature: zoom increased from the wide start.
    const after = await page.evaluate(() => (window as any).__demo.maps.compiled.getZoom());
    expect(after, `zoom ${before} -> ${after}`).toBeGreaterThan(before + 0.5);

    // AE3, the trusted half: the host handler fired with the projected payload.
    const compiledEmit = await page.evaluate(() => (window as any).__demo.compiledEmit);
    expect(compiledEmit).toEqual({
      id: "P1",
      kind: "parcel",
      name: "<script>alert('xss')</script> Parcel",
    });

    // ---- AE6: host-constructed map — same interactions, then destroy() ------
    await fireAtCentre(page, "host", "click");
    const hostEmit = await page.evaluate(() => (window as any).__demo.hostEmit);
    expect(hostEmit, "host-constructed map did not fire emit").toEqual({
      id: "P1",
      kind: "parcel",
      name: "<script>alert('xss')</script> Parcel",
    });
    expect(await popupHtml(page, "map-host")).toContain("<b>Bold from !html</b>");

    // destroy() removes the open popup and detaches every listener.
    await page.evaluate(() => (window as any).__demo.hostHandle.destroy());
    expect(await popupHtml(page, "map-host"), "destroy() left the popup open").toBe("");

    // A later event does nothing: the handler stays unfired and no popup opens.
    await page.evaluate(() => ((window as any).__demo.hostEmit = null));
    await fireAtCentre(page, "host", "click");
    const afterDestroyEmit = await page.evaluate(() => (window as any).__demo.hostEmit);
    expect(afterDestroyEmit, "a detached map still dispatched an interaction").toBeNull();
    expect(await popupHtml(page, "map-host"), "a detached map still opened a popup").toBe("");

    // The hermetic guard: no console errors, no off-origin requests.
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
