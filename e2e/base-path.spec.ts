/**
 * `<ml-map base>` on a site published under a subpath (ml-aot.30) — browser
 * verification, which is also the demo (examples/verification/base-path/).
 *
 * @remarks
 * The e2e server mounts `examples/verification/base-path/site/` at
 * `/my-repo/`, the way GitHub Pages serves a project site, and serves nothing
 * else under that prefix: a path the page fails to put under the base falls
 * through to the repo root and 404s, as on `<user>.github.io`. The document
 * names its own files with no repo name (`/data/cities.geojson`,
 * `data/route.geojson`, `./data/peaks.geojson`, `/images/tri.png`,
 * `/images/pin.png`, `styles/basemap.json`).
 *
 * The same page without `base` must show the data notice: that is what makes
 * the passing case meaningful.
 */
import { test, expect, type Page } from "@playwright/test";

/** Fail on page errors and off-origin requests (hermeticity); record 404s. */
async function guard(page: Page): Promise<{ errors: string[]; notFound: string[] }> {
  const errors: string[] = [];
  const notFound: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() === 404) notFound.push(new URL(r.url()).pathname);
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || url.startsWith("data:") || url.startsWith("blob:")) {
      return route.continue();
    }
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return { errors, notFound };
}

/** Wait for the map to load and report what reached it. */
async function mapState(page: Page) {
  await page.evaluate(() => (document.getElementById("map") as any).mapReady());
  await page.waitForFunction(
    () => {
      const map = (document.getElementById("map") as any).getMap();
      return map.querySourceFeatures("route-source").length > 0;
    },
    undefined,
    { timeout: 30_000 }
  );
  // Let the remaining fetches (and any failure notices) settle.
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const el = document.getElementById("map") as any;
    const map = el.getMap();
    const img = el.querySelector("img.maplibregl-marker") as HTMLImageElement | null;
    // Features repeat across tiles: count distinct ones.
    const distinct = (source: string) =>
      new Set(map.querySourceFeatures(source).map((f: any) => JSON.stringify(f.geometry))).size;
    return {
      cities: distinct("cities"),
      // A line is clipped into pieces per tile: just whether it drew.
      route: map.querySourceFeatures("route-source").length > 0,
      peaks: distinct("peaks-source"),
      tri: map.hasImage("tri"),
      markerIcon: img ? { src: new URL(img.src).pathname, loaded: img.complete && img.naturalWidth > 0 } : null,
      notice: el.querySelector(".ml-map-notice")?.innerText.replace(/\s+/g, " ").trim() ?? null,
    };
  });
}

const LOADED = {
  cities: 3,
  route: true,
  peaks: 2,
  tri: true,
  markerIcon: { src: "/my-repo/images/pin.png", loaded: true },
  notice: null,
};

test.describe("a site under /my-repo/ (GitHub Pages project site)", () => {
  test("with base, every path in the document loads: data, images, marker icon, basemap", async ({ page }) => {
    const { errors, notFound } = await guard(page);
    await page.goto("/my-repo/", { waitUntil: "domcontentloaded" });
    const state = await mapState(page);
    expect(state).toEqual(LOADED);
    expect(notFound).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("a nested page with base: relative paths resolve against the base, not the page", async ({ page }) => {
    const { errors, notFound } = await guard(page);
    await page.goto("/my-repo/blog/post/", { waitUntil: "domcontentloaded" });
    const state = await mapState(page);
    expect(state).toEqual(LOADED);
    expect(notFound).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("without base, the root-relative paths 404 and the notice says to add base", async ({ page }) => {
    const { errors, notFound } = await guard(page);
    await page.goto("/my-repo/no-base.html", { waitUntil: "domcontentloaded" });
    const state = await mapState(page);
    // Relative paths still resolve against this page (at the site root).
    expect(state.route).toBe(true);
    expect(state.peaks).toBe(2);
    // The root-relative ones went to the domain root.
    expect(state.cities).toBe(0);
    expect(state.tri).toBe(false);
    expect(notFound).toEqual(
      expect.arrayContaining(["/data/cities.geojson", "/images/tri.png", "/images/pin.png"])
    );
    const notice = state.notice ?? "";
    expect(notice).toContain("Data file /data/cities.geojson didn't load (404 Not Found), so layer cities has no data.");
    expect(notice).toMatch(/The browser looked for http:\/\/localhost:\d+\/data\/cities\.geojson\./);
    expect(notice).toContain(
      'If this site is published under /my-repo/ (a GitHub Pages project site, for example), add base="/my-repo/" to <ml-map> so paths starting with "/" start there.'
    );
    expect(notice).toContain("Image tri (/images/tri.png) didn't load");
    expect(notice).toContain("Marker 1's icon (/images/pin.png) didn't load");
    expect(errors).toEqual([]);
  });

  test("<base href> instead of the attribute: relative paths load, /paths still start at the domain root", async ({ page }) => {
    const { errors, notFound } = await guard(page);
    await page.goto("/my-repo/base-href.html", { waitUntil: "domcontentloaded" });
    const state = await mapState(page);
    expect(state.route).toBe(true);
    expect(state.peaks).toBe(2);
    expect(state.cities).toBe(0);
    expect(notFound).toContain("/data/cities.geojson");
    expect(errors).toEqual([]);
  });

  test("setting base later re-renders with the paths resolved", async ({ page }) => {
    const { errors } = await guard(page);
    await page.goto("/my-repo/no-base.html", { waitUntil: "domcontentloaded" });
    await mapState(page);
    await page.evaluate(() => {
      (document.getElementById("map") as any).base = "/my-repo/";
    });
    const state = await mapState(page);
    expect(state).toEqual(LOADED);
    expect(errors).toEqual([]);
  });
});
