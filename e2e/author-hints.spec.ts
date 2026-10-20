/**
 * Failures always show; author hints only while developing (ml-aot.57) —
 * browser verification and demo (examples/verification/author-hints/map.html,
 * examples/verification/student-errors/story-mistakes.html).
 *
 * The same pages are opened two ways:
 *
 * - from `localhost` (developing): the notice lists the failure AND the
 *   hints, details open;
 * - from `students.example.org` (a published site; Chromium resolves it to
 *   this machine): the failure only, details collapsed, and a map whose
 *   only problems are hints shows no notice at all;
 * - `?debug` puts the hints back on the published site; `?quiet` hides
 *   everything. The console gets every hint either way.
 */
import { test, expect, type Page } from "@playwright/test";

const PORT = Number(process.env.VERIFY_PORT ?? 4174);
const LOCAL = `http://localhost:${PORT}`;
const PUBLISHED = `http://students.example.org:${PORT}`;
const MAP_PAGE = "/examples/verification/author-hints/map.html";
const STORY_PAGE = "/examples/verification/student-errors/story-mistakes.html";

// Same GPU flags as playwright.config.ts, plus a name for a "published" host.
test.use({
  launchOptions: {
    args: [
      "--use-gl=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--host-resolver-rules=MAP students.example.org 127.0.0.1",
    ],
  },
});

const HINTS = [
  'Strings starting with "=" are reserved for a future expression shorthand',
  '"markers" belongs at the top level',
  "Coordinates are [longitude, latitude]",
];
const FAILURE = "Data file data/not-here.geojson didn't load (404 Not Found)";

function watch(page: Page): { errors: string[]; console: string[] } {
  const seen = { errors: [] as string[], console: [] as string[] };
  page.on("pageerror", (e) => seen.errors.push(e.message));
  page.on("console", (m) => seen.console.push(m.text()));
  return seen;
}

/** Open the map page and wait until both maps loaded and the 404 landed. */
async function openMaps(page: Page, origin: string, query = "") {
  await page.goto(`${origin}${MAP_PAGE}${query}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() =>
    Promise.all(Array.from(document.querySelectorAll("ml-map")).map((m: any) => m.mapReady()))
  );
  // The data 404 is reported once its fetch settles (on the page, unless quiet).
  if (!query.includes("quiet")) {
    await expect(page.locator("#mixed .ml-map-notice")).toContainText("not-here.geojson", {
      timeout: 30_000,
    });
  }
  await page.waitForTimeout(500);
}

const noticeText = async (page: Page, id: string) =>
  ((await page.locator(`#${id} .ml-map-notice`).textContent()) ?? "").replace(/\s+/g, " ");

test.describe("author hints show while developing, failures always (ml-aot.57)", () => {
  test("localhost: the failure and every hint, details open", async ({ page }) => {
    const seen = watch(page);
    await openMaps(page, LOCAL);
    const mixed = page.locator("#mixed .ml-map-notice");
    await expect(mixed.locator("strong")).toHaveText("Part of this map couldn't load");
    expect(await mixed.locator("details").evaluate((d: HTMLDetailsElement) => d.open)).toBe(true);
    const text = await noticeText(page, "mixed");
    expect(text).toContain(FAILURE);
    for (const hint of HINTS) expect(text).toContain(hint);
    // Nothing failed on map 2: its notice is worded as notes, not a failure.
    await expect(page.locator("#hints-only .ml-map-notice strong")).toHaveText("Notes for this map's author");
    expect(await noticeText(page, "hints-only")).toContain('"legend" belongs at the top level');
    await page.screenshot({ path: "e2e/results/small_hints-localhost.png" });
    expect(seen.errors).toEqual([]);
  });

  test("published host: the failure only, details collapsed; a hints-only map shows nothing", async ({ page }) => {
    const seen = watch(page);
    await openMaps(page, PUBLISHED);
    const mixed = page.locator("#mixed .ml-map-notice");
    await expect(mixed.locator("strong")).toHaveText("Part of this map couldn't load");
    expect(await mixed.locator("details").evaluate((d: HTMLDetailsElement) => d.open)).toBe(false);
    const text = await noticeText(page, "mixed");
    expect(text).toContain(FAILURE);
    for (const hint of HINTS) expect(text).not.toContain(hint);
    await expect(page.locator("#hints-only .ml-map-notice")).toHaveCount(0);
    // The console still gets every hint.
    for (const hint of HINTS.slice(0, 2)) {
      expect(seen.console.some((line) => line.includes(hint)), `console lacks: ${hint}`).toBe(true);
    }
    await page.screenshot({ path: "e2e/results/small_hints-published.png" });
    expect(seen.errors).toEqual([]);
  });

  test("published host with debug: the hints are back, details open", async ({ page }) => {
    const seen = watch(page);
    await openMaps(page, PUBLISHED, "?debug");
    const text = await noticeText(page, "mixed");
    expect(text).toContain(FAILURE);
    for (const hint of HINTS) expect(text).toContain(hint);
    expect(
      await page.locator("#mixed .ml-map-notice details").evaluate((d: HTMLDetailsElement) => d.open)
    ).toBe(true);
    await expect(page.locator("#hints-only .ml-map-notice strong")).toHaveText("Notes for this map's author");
    // Turning debug off again takes the hints (not the failure) back off.
    await page.evaluate(() => document.querySelectorAll("ml-map").forEach((m) => m.removeAttribute("debug")));
    const after = await noticeText(page, "mixed");
    expect(after).toContain(FAILURE);
    for (const hint of HINTS) expect(after).not.toContain(hint);
    await expect(page.locator("#hints-only .ml-map-notice")).toHaveCount(0);
    await page.evaluate(() => document.querySelectorAll("ml-map").forEach((m) => m.setAttribute("debug", "")));
    await page.screenshot({ path: "e2e/results/small_hints-published-debug.png" });
    expect(seen.errors).toEqual([]);
  });

  test("quiet still hides everything, wherever it is served", async ({ page }) => {
    const seen = watch(page);
    await openMaps(page, LOCAL, "?quiet&debug");
    await expect(page.locator(".ml-map-notice")).toHaveCount(0);
    expect(seen.errors).toEqual([]);
  });

  test("a story on a published host: its hints hidden, the missing photo still noted; debug brings the hints", async ({
    page,
  }) => {
    const seen = watch(page);
    await page.goto(`${PUBLISHED}${STORY_PAGE}`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => (document.getElementById("story") as any).mapReady().then(() => null));
    await page.evaluate(() => (document.getElementById("story") as any).goToChapter("route"));
    const missing = page.locator('.scrolly-chapter[data-chapter-id="start"] .chapter-media-missing');
    await expect(missing).toBeVisible({ timeout: 15_000 });
    expect(await missing.locator("details").evaluate((d: HTMLDetailsElement) => d.open)).toBe(false);
    await page.waitForTimeout(1500);
    await expect(page.locator("#story .ml-map-notice")).toHaveCount(0);
    expect(seen.console.some((l) => l.includes('"theme" belongs at the top level'))).toBe(true);

    await page.goto(`${PUBLISHED}${STORY_PAGE}?debug`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => (document.getElementById("story") as any).mapReady().then(() => null));
    const notice = page.locator("#story .ml-map-notice");
    await expect(notice).toContainText('"theme" belongs at the top level', { timeout: 30_000 });
    await page.evaluate(() => (document.getElementById("story") as any).goToChapter("route"));
    await expect(notice).toContainText("route shows layer walking, but the map has no layer by that name");
    expect(await page.locator("#story ml-map").getAttribute("debug")).toBe("");
    await page.screenshot({ path: "e2e/results/small_hints-story-debug.png" });
    expect(seen.errors).toEqual([]);
  });
});
