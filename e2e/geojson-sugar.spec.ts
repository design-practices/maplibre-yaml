/**
 * v0.5.0 GeoJSON-sugar — browser verification, which is also the demo.
 *
 * @remarks
 * The unit suites prove the expander turns each authored sugar node into the
 * `Feature`/`FeatureCollection` it stands for, and that the parse seam expands
 * sugar before validation. What only a real browser proves is the claim of the
 * feature: a `type: geojson` source authored with `location`, `locations`,
 * `region`, or `route` — and nothing else — renders through the flagship
 * `<ml-map>` element (parse -> expand -> toModel -> render). If sugar ever
 * reached the renderer unexpanded, the source would carry no `data` and its
 * layer would draw nothing — which is exactly what this test would catch.
 *
 * The same page a user opens to see the four sugars is the page this test drives.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGE = "/examples/verification/geojson-sugar.html";

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

test.describe("geojson sugar: the four data-position shorthands render via <ml-map>", () => {
  test("location, locations, region, and route each expand and render", async ({
    page,
  }) => {
    const errors = await guard(page);
    await page.goto(PAGE, { waitUntil: "domcontentloaded" });

    // The map's style has loaded and every sugar-backed layer is present. Each
    // of the four layers draws from a source whose `data` came from a sugar; a
    // layer only exists once its source resolved, so this is the render proof.
    await page.waitForFunction(
      () => {
        const map = (document.getElementById("map") as any)?.getMap?.();
        if (!map || !map.isStyleLoaded?.()) return false;
        return ["district-fill", "path-line", "stops-dots", "site-dot"].every(
          (id) => Boolean(map.getLayer?.(id))
        );
      },
      undefined,
      { timeout: 60_000 }
    );

    // (1) The map actually painted — a real canvas with non-zero extent.
    const painted = await page.evaluate(() => {
      const c = document
        .getElementById("map")!
        .querySelector("canvas.maplibregl-canvas") as HTMLCanvasElement | null;
      return Boolean(c && c.width > 0 && c.height > 0);
    });
    expect(painted, "map canvas did not paint").toBe(true);

    // (2) Every sugar expanded at the parse seam: each source's `data` is the
    // GeoJSON the sugar stands for, with the authored name in `properties`.
    // Read from the parser output the page exposed — the expansion, not a proxy.
    const expanded = await page.evaluate(() => {
      const s = (window as any).__sugarSources;
      const geom = (key: string) => s[key]?.data?.geometry?.type;
      return {
        // location -> a single Point Feature
        siteType: s.site?.data?.type,
        siteGeom: geom("site"),
        siteName: s.site?.data?.properties?.name,
        // locations -> a FeatureCollection of Points
        stopsType: s.stops?.data?.type,
        stopsCount: s.stops?.data?.features?.length,
        stopsFirstGeom: s.stops?.data?.features?.[0]?.geometry?.type,
        // region -> a Polygon Feature
        districtType: s.district?.data?.type,
        districtGeom: geom("district"),
        districtRings: s.district?.data?.geometry?.coordinates?.length,
        // route -> a LineString Feature (>= 2 positions)
        pathType: s.path?.data?.type,
        pathGeom: geom("path"),
        pathPositions: s.path?.data?.geometry?.coordinates?.length,
      };
    });
    expect(expanded).toEqual({
      siteType: "Feature",
      siteGeom: "Point",
      siteName: "Site",
      stopsType: "FeatureCollection",
      stopsCount: 2,
      stopsFirstGeom: "Point",
      districtType: "Feature",
      districtGeom: "Polygon",
      districtRings: 1,
      pathType: "Feature",
      pathGeom: "LineString",
      pathPositions: 3,
    });

    // (3) The live map carries the expanded data too — the renderer consumed
    // the Feature/FeatureCollection, not the raw sugar. `serialize()` on a
    // GeoJSON source returns its inline `data`.
    const live = await page.evaluate(() => {
      const map = (document.getElementById("map") as any).getMap();
      const dataType = (id: string) => {
        const src = map.getSource(id);
        const data = src?.serialize?.().data;
        return data?.type ?? null;
      };
      return {
        site: dataType("site"),
        stops: dataType("stops"),
        district: dataType("district"),
        path: dataType("path"),
      };
    });
    expect(live).toEqual({
      site: "Feature",
      stops: "FeatureCollection",
      district: "Feature",
      path: "Feature",
    });

    // (4) No parse warnings on the well-formed sugar document, and no console
    // errors or off-origin requests (the hermetic guard).
    const warnings = await page.evaluate(() => (window as any).__sugarWarnings);
    expect(warnings, JSON.stringify(warnings)).toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
