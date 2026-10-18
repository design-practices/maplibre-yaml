/**
 * Student mistakes show an actionable message ON THE PAGE — browser
 * verification, which is also the demo (examples/verification/student-errors/).
 *
 * @remarks
 * A classroom audit (vanilla HTML + CDN) found that the common mistakes left
 * a blank box or a basemap without the student's layer, with the reason only
 * on the console: a bad mapStyle URL (ml-aot.14), layer-level mistakes
 * (ml-aot.15), src fetch failures including file:// (ml-aot.13), typos and
 * unquoted colours (ml-okw), bare relative data paths (ml-zft), and a map
 * with no height (ml-aot.16). Every assertion here is on text a student can
 * SEE — the card, the notice, the hint — not on console output.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIR = "/examples/verification/student-errors";

/** Fail on page errors and off-origin requests (hermeticity). */
async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || url.startsWith("data:")) {
      return route.continue();
    }
    if (url.startsWith("file:") || url.startsWith("https://cdn.test/")) return route.fallback();
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

/** Visible text of an element, whitespace-collapsed. */
const text = (page: Page, selector: string) =>
  page.locator(selector).first().innerText().then((t) => t.replace(/\s+/g, " ").trim());

test.describe("the basemap style (ml-aot.14)", () => {
  test("a 404 style URL shows a card naming the URL, and mapReady() rejects", async ({ page }) => {
    const errors = await guard(page);
    await page.goto(`${DIR}/bad-style.html`, { waitUntil: "domcontentloaded" });
    const card = page.locator("#map .ml-map-error");
    await expect(card).toBeVisible({ timeout: 30_000 });
    const shown = await text(page, "#map .ml-map-error");
    expect(shown).toContain("The basemap style didn't load");
    expect(shown).toContain('config.mapStyle: Could not load the basemap style "/examples/verification/configs/local-styles.json": 404');
    expect(shown).toContain("How to fix it: Check config.mapStyle");
    expect(await card.getAttribute("role")).toBe("alert");

    // It settles — before the fix it neither resolved nor rejected.
    const outcome = await page.evaluate(() =>
      (document.getElementById("map") as any).mapReady().then(
        () => "resolved",
        (e: Error) => `rejected: ${e.message}`
      )
    );
    expect(outcome).toMatch(/^rejected: .*404/);
    expect(errors).toEqual([]);
  });

  test("a URL that is not a style says so", async ({ page }) => {
    await guard(page);
    await page.goto(`${DIR}/not-a-style.html`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#map .ml-map-error")).toBeVisible({ timeout: 30_000 });
    const shown = await text(page, "#map .ml-map-error");
    expect(shown).toContain("The basemap style didn't load");
    expect(shown).toContain("isn't a valid MapLibre style");
  });
});

test.describe("layer problems keep the map working (ml-aot.15)", () => {
  test("a notice lists each broken layer by name; the good layer draws and the map loads", async ({ page }) => {
    const errors = await guard(page);
    await page.goto(`${DIR}/layer-problems.html`, { waitUntil: "domcontentloaded" });

    // The document loads: the good layer is on the map.
    const loaded = await page.evaluate(() =>
      (document.getElementById("map") as any).mapReady().then((map: any) => Boolean(map.getLayer("good")))
    );
    expect(loaded).toBe(true);

    const notice = page.locator("#map .ml-map-notice");
    await expect(notice).toContainText("missing-data", { timeout: 30_000 });
    await expect(notice).toContainText("typo-layer");
    await expect(notice).toContainText("bad-colour");
    expect(await notice.getAttribute("role")).toBe("status");
    const shown = await text(page, "#map .ml-map-notice");
    expect(shown).toContain("Part of this map didn't load");
    expect(shown).toContain('Layer typo-layer didn\'t draw: Source "citeis" doesn\'t exist. Did you mean "cities"?');
    expect(shown).toContain("Data file data/citys.geojson didn't load (404 Not Found), so layer missing-data has no data.");
    expect(shown).toMatch(/The browser looked for http:\/\/localhost:\d+\/examples\/verification\/student-errors\/data\/citys\.geojson/);
    expect(shown).toMatch(/Layer bad-colour didn't draw: .*'bleu'.* Did you mean "blue"\?/);
    // No error card: this is not a failed document.
    await expect(page.locator("#map .ml-map-error")).toHaveCount(0);

    // Dismissible.
    await notice.getByRole("button", { name: "Dismiss this notice" }).click();
    await expect(page.locator("#map .ml-map-notice")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("`quiet` keeps the notice off the page", async ({ page }) => {
    await guard(page);
    await page.goto(`${DIR}/layer-problems.html`, { waitUntil: "domcontentloaded" });
    // Wait until the default map has reported the data 404, so the quiet one
    // has had the same chance.
    await expect(page.locator("#map .ml-map-notice")).toContainText("missing-data", { timeout: 30_000 });
    await page.evaluate(() => (document.getElementById("quiet-map") as any).mapReady());
    await expect(page.locator("#quiet-map .ml-map-notice")).toHaveCount(0);
  });
});

test.describe("src fetch failures (ml-aot.13)", () => {
  test("a missing src file shows the URL the browser requested", async ({ page }) => {
    await guard(page);
    await page.goto(`${DIR}/src-404.html`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#map .ml-map-error")).toBeVisible({ timeout: 30_000 });
    const shown = await text(page, "#map .ml-map-error");
    expect(shown).toContain("Map file not found");
    expect(shown).toContain('Couldn\'t load src="configs/my-map.yaml": 404');
    expect(shown).toMatch(/The browser looked for it at http:\/\/localhost:\d+\/examples\/verification\/student-errors\/configs\/my-map\.yaml/);
  });

  test("base set but the page previewed outside it: both cards name base and the local-preview fix (ml-aot.36)", async ({ page }) => {
    const errors = await guard(page);
    await page.goto(`${DIR}/base-preview.html`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#map .ml-map-error")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#story .scrolly-error, #story .ml-map-error").first()).toBeVisible({ timeout: 30_000 });
    for (const [selector, title, file] of [
      ["#map .ml-map-error", "Map file not found", "map.yaml"],
      ["#story .scrolly-error, #story .ml-map-error", "Story file not found", "story.yaml"],
    ] as const) {
      const shown = await text(page, selector);
      expect(shown).toContain(title);
      expect(shown).toMatch(new RegExp(`The browser looked for it at http://localhost:\\d+/my-repo/${file.replace(".", "\\.")}`));
      expect(shown).toContain('This page sets base="/my-repo/", so files are looked up under /my-repo/');
      expect(shown).toContain(
        "If you're previewing locally, either remove base while developing, or serve the folder one level up and open /my-repo/. " +
          'That folder must be named "my-repo" (a GitHub "Download ZIP" folder is called "my-repo-main": rename it).'
      );
      expect(shown).not.toContain("relative to this page's folder");
    }
    await page.screenshot({ path: "e2e/results/base-preview-cards.png", fullPage: true });
    expect(errors).toEqual([]);
  });

  test("a root key nested under config: is named on the map, not just the console (ml-aot.48)", async ({ page }) => {
    const errors = await guard(page);
    await page.goto(`${DIR}/misplaced-keys.html`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#map .ml-map-notice")).toBeVisible({ timeout: 30_000 });
    const shown = await text(page, "#map .ml-map-notice");
    expect(shown).toContain('"markers" belongs at the top level');
    expect(shown).toMatch(/line \d+/);
    expect(errors).toEqual([]);
  });

  test("story mistakes show on the page: layers.show typo, theme under config, a missing chapter image (ml-aot.48/.51)", async ({
    page,
  }) => {
    const errors = await guard(page);
    await page.goto(`${DIR}/story-mistakes.html`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => (document.getElementById("story") as any).mapReady().then(() => null));
    const notice = page.locator("#story .ml-map-notice");
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText('"theme" belongs at the top level');
    // The layers.show typo is found when its chapter runs, against the map's
    // real layers (a basemap layer would be fine).
    await page.evaluate(() => (document.getElementById("story") as any).goToChapter("route"));
    await expect(notice).toContainText("route shows layer walking, but the map has no layer by that name. Did you mean walk?");
    const missing = page.locator('.scrolly-chapter[data-chapter-id="start"] .chapter-media-missing');
    await expect(missing).toBeVisible({ timeout: 15_000 });
    await expect(missing).toContainText("Volcano.SVG");
    await expect(missing).toContainText("capital letters");
    await page.screenshot({ path: "e2e/results/story-mistakes.png" });
    expect(errors).toEqual([]);
  });

  test("a chapter action naming a missing layer is on the page, with a did-you-mean (ml-aot.51)", async ({ page }) => {
    const errors = await guard(page);
    await page.goto(`${DIR}/story-mistakes.html`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => (document.getElementById("story") as any).mapReady().then(() => null));
    await page.evaluate(() => (document.getElementById("story") as any).goToChapter("filter"));
    await expect(page.locator("#story .ml-map-notice")).toContainText(
      "Chapter filter: its setFilter action names layer wlak, but the map has no layer by that name, so it did nothing. Did you mean walk?"
    );
    expect(errors).toEqual([]);
  });

  test("a src that returns a web page says the path is probably wrong", async ({ page }) => {
    await guard(page);
    await page.goto(`${DIR}/src-html.html`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#map .ml-map-error")).toBeVisible({ timeout: 30_000 });
    const shown = await text(page, "#map .ml-map-error");
    expect(shown).toContain('src="not-yaml.html" points at an HTML page, not a YAML file');
    expect(shown).not.toContain("YAML syntax error");
  });

  /**
   * A plain-HTML page opened by double-clicking (file://), loading core and
   * maplibre-gl from a CDN. The CDN is simulated: https://cdn.test/ is routed
   * to this server with the CORS header a real CDN sends.
   */
  async function openAsFile(page: Page, baseURL: string, body: string): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "mlym-file-"));
    writeFileSync(join(dir, "map.yaml"), "type: map\nid: m\nconfig:\n  center: [0, 0]\n  zoom: 1\n  mapStyle: \"https://cdn.test/examples/verification/configs/local-style.json\"\nlayers: []\n");
    writeFileSync(
      join(dir, "index.html"),
      `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.test/vendor/maplibre-gl.css">
<script type="importmap">{ "imports": { "maplibre-gl": "https://cdn.test/vendor/maplibre-gl.esm.js" } }</script>
<script type="module" src="https://cdn.test/packages/core/register.js"></script>
</head><body>${body}</body></html>`
    );
    await page.route("https://cdn.test/**", async (route: Route) => {
      const local = route.request().url().replace("https://cdn.test", baseURL);
      const response = await route.fetch({ url: local });
      await route.fulfill({
        response,
        headers: { ...response.headers(), "access-control-allow-origin": "*" },
      });
    });
    await page.goto(`file://${join(dir, "index.html")}`, { waitUntil: "domcontentloaded" });
  }

  test("a page opened from a file (file://) says to start a local server", async ({ page, baseURL }) => {
    await guard(page);
    await openAsFile(page, baseURL!, '<ml-map src="map.yaml" style="display:block;height:400px"></ml-map>');
    await expect(page.locator("ml-map .ml-map-error")).toBeVisible({ timeout: 30_000 });
    const shown = await text(page, "ml-map .ml-map-error");
    expect(shown).toContain("Open this page through a local web server");
    expect(shown).toContain('This page was opened from a file (file://), and browsers block it from loading "map.yaml" that way.');
    expect(shown).toContain('npx serve .');
    expect(shown).not.toContain("Failed to fetch");
  });

  test("file:// with inline YAML on maplibre-gl 6 says to serve the folder, not to configure a bundler", async ({ page, baseURL }) => {
    await guard(page);
    await openAsFile(
      page,
      baseURL!,
      `<ml-map style="display:block;height:400px"><script type="text/yaml">
type: map
id: inline
config:
  center: [0, 0]
  zoom: 1
  mapStyle: "https://cdn.test/examples/verification/configs/local-style.json"
layers: []
</script></ml-map>`
    );
    const major = await page.evaluate(async () => {
      const gl: any = await import("maplibre-gl");
      return Number(String((gl.getVersion?.() ?? gl.default?.getVersion?.() ?? "0")).split(".")[0]);
    });
    // maplibre-gl 4/5 start their worker from a blob and may render here.
    test.skip(major < 6, "only maplibre-gl 6 cannot start its worker from a file:// page");
    await expect(page.locator("ml-map .ml-map-error")).toBeVisible({ timeout: 30_000 });
    const shown = await text(page, "ml-map .ml-map-error");
    expect(shown).toContain("Open this page through a local web server");
    expect(shown).not.toContain("setWorkerUrl");
  });
});

test.describe("validation messages name the fix (ml-okw)", () => {
  const cases: Array<[string, string]> = [
    ["centre", 'config.centre: Unknown key "centre" — did you mean "center"? ("center" is required here.)'],
    ["unquoted", 'layers.0.paint.circle-color: Colours starting with # must be quoted: circle-color: "#e63946".'],
    ["bleu", 'layers.0.paint.circle-color: "bleu" is not a colour name. Did you mean "blue"?'],
    ["smart", "layers.0.paint.circle-color: Curly quotes (“ ”) are not YAML quotes"],
    ["swapped", "config.center.1: Value must be >= -90. Coordinates are [longitude, latitude] — longitude first. Did you mean [-98, 39]?"],
    ["units", 'layers.0.paint.circle-radius: Expected number or array, got string. Write a plain number, without quotes or units: 10'],
  ];
  test("each mistake's card says what to write instead, with the line", async ({ page }) => {
    await guard(page);
    await page.goto(`${DIR}/validation.html`, { waitUntil: "domcontentloaded" });
    for (const [id, expected] of cases) {
      await expect(page.locator(`#${id} .ml-map-error`)).toBeVisible({ timeout: 30_000 });
      const shown = await text(page, `#${id} .ml-map-error`);
      expect(shown, id).toContain(expected);
      expect(shown, id).toMatch(/\(line \d+\)/);
    }
  });
});

test.describe("relative data paths (ml-zft)", () => {
  test("bare relative paths load; one written relative to the YAML file gets the page-relative fix", async ({ page }) => {
    const errors = await guard(page);
    await page.goto(`${DIR}/relative-paths.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => {
        const map = (document.getElementById("map") as any)?.getMap?.();
        return map && map.querySourceFeatures?.("from-page-source").length > 0;
      },
      undefined,
      { timeout: 30_000 }
    );
    const notice = page.locator("#map .ml-map-notice");
    await expect(notice).toContainText("from-yaml", { timeout: 30_000 });
    const shown = await text(page, "#map .ml-map-notice");
    expect(shown).toContain("Data file cities.geojson didn't load (404 Not Found), so layer from-yaml has no data.");
    expect(shown).toContain("relative paths start from the page, not from the YAML file. If the file is next to your YAML, write maps/cities.geojson.");
    expect(shown).not.toContain("from-page");
    expect(errors).toEqual([]);
  });
});

test.describe("a map with no height (ml-aot.16)", () => {
  test("warns on the page even with a slot child, and the hint goes once the map has a height", async ({ page }) => {
    await guard(page);
    await page.goto(`${DIR}/zero-height.html`, { waitUntil: "domcontentloaded" });
    const hint = page.locator("#map .ml-map-height-hint");
    await expect(hint).toBeVisible({ timeout: 30_000 });
    expect(await text(page, "#map .ml-map-height-hint")).toContain(
      'This map is invisible because the <ml-map> element has no height. Give it one, for example <ml-map style="display:block; height:400px">'
    );

    await page.getByRole("button", { name: "Give the map a height" }).click();
    await expect(hint).toHaveCount(0);
    const height = await page.evaluate(
      () => document.querySelector("#map .ml-map-container")!.getBoundingClientRect().height
    );
    expect(height).toBeGreaterThan(300);
  });
});
