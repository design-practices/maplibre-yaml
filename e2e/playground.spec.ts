/**
 * The docs playground (ml-vjs.17) — browser verification, which is also the
 * demo: open http://localhost:<port>/playground/ on the e2e server after a
 * build to try it by hand.
 *
 * Drives the BUILT docs page (`pnpm build` first; e2e/server.mjs mounts
 * docs/dist at /playground/, with the /configs/, /schema/ and /data/ files
 * it loads). Covered, at 1280×800 and 390×844:
 *  - the default map renders from the editor's document;
 *  - an edit re-renders the map and keeps the camera the reader panned to;
 *  - a mistake is underlined, the map keeps the last working version, and
 *    the "Change to …" quick fix repairs the document;
 *  - schema completion offers the keys that fit where the cursor is;
 *  - a share link reopens the identical document, with the banner listing
 *    the sites it names;
 *  - Download saves a zip whose page, document and README work as a folder;
 *  - a story map: the "Start here" story starter renders in
 *    <ml-scrollytelling> with its chapter rail and legend; editing a chapter
 *    and the legend re-renders them; scrolling the pane moves the map; a
 *    share link reopens it; Download saves story.yaml with an index.html
 *    that uses <ml-scrollytelling>;
 *  - on a phone, the editor and map stack, and a story map opens full height
 *    under a "Back to code" bar that leaves the story's legend button free;
 *  - the header's Examples and Playground links (desktop), and the site menu
 *    that carries them on a phone, where this page has no sidebar menu.
 *
 * Hermetic like the rest of the suite: the basemap styles and the USGS feed
 * are answered locally, and any other off-box request fails the test.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const REPO = join(__dirname, "..");
const DIST = join(REPO, "docs", "dist");
const LOCAL_STYLE = JSON.parse(readFileSync(join(REPO, "examples/verification/configs/local-style.json"), "utf8"));
// fflate is the playground's own dependency (docs/package.json): unzip with it.
const { unzipSync, strFromU8 } = createRequire(join(REPO, "docs", "package.json"))("fflate");

const QUAKES = {
  type: "FeatureCollection",
  features: [
    [-120, 37, 3.1, "Central California"],
    [139.7, 35.7, 5.2, "Near Tokyo"],
    [-72, -33, 6.4, "Offshore Valparaíso"],
  ].map(([lng, lat, mag, place]) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { mag, place, title: `M ${mag} - ${place}` },
  })),
};

const MAP = "#pg-preview ml-map";
const STORY = "#pg-preview ml-scrollytelling";
const STORY_SRC = "/configs/earthquake-story.yaml";

/** Page errors fail the test; the basemap and the feed are local; nothing else leaves the box. */
async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.route("**/*", (route: Route) => {
    const url = new URL(route.request().url());
    if (/^(localhost|127\.0\.0\.1)$/.test(url.hostname) || /^(data|blob):/.test(url.protocol)) {
      return route.continue();
    }
    if (url.origin === "https://tiles.openfreemap.org" && url.pathname.startsWith("/styles/")) {
      return route.fulfill({ json: LOCAL_STYLE });
    }
    if (url.hostname === "earthquake.usgs.gov") return route.fulfill({ json: QUAKES });
    errors.push(`external request (suite must stay hermetic): ${url.href}`);
    return route.abort();
  });
  return errors;
}

function requireBuild(): void {
  expect(
    existsSync(join(DIST, "playground", "index.html")),
    "docs/dist/playground/index.html is missing — build the docs first (pnpm build)",
  ).toBe(true);
}

/** Open the playground and wait for the editor and a drawn map with `layer`. */
async function open(page: Page, query: string, layer?: string): Promise<void> {
  await page.goto(`/playground/${query}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".pg-root")).toHaveAttribute("data-editor", "ready", { timeout: 60_000 });
  if (layer) await waitForLayer(page, layer);
}

async function waitForLayer(page: Page, layer: string, color?: string): Promise<void> {
  await page.waitForFunction(
    ([sel, id, want]) => {
      const map = (document.querySelector(sel) as any)?.getMap?.();
      if (!map || !map.isStyleLoaded?.() || !map.getLayer?.(id)) return false;
      return want === null || map.getPaintProperty(id, "circle-color") === want;
    },
    [MAP, layer, color ?? null] as const,
    { timeout: 60_000 },
  );
}

const renders = async (page: Page) => Number(await page.locator(".pg-root").getAttribute("data-renders"));
const docText = (page: Page) => page.evaluate(() => (window as any).__playground.getText() as string);
const camera = (page: Page) =>
  page.evaluate((sel) => {
    const map = (document.querySelector(sel) as any).getMap();
    const c = map.getCenter();
    return { lng: c.lng, lat: c.lat, zoom: map.getZoom() };
  }, MAP);

/** Wait until the story's map has drawn `layer`. */
async function waitForStoryLayer(page: Page, layer: string): Promise<void> {
  await page.waitForFunction(
    ([sel, id]) => {
      const map = (document.querySelector(`${sel} ml-map`) as any)?.getMap?.();
      return Boolean(map && map.isStyleLoaded?.() && map.getLayer?.(id));
    },
    [STORY, layer] as const,
    { timeout: 60_000 },
  );
}

/**
 * Scroll the editor until a line matching `match` is drawn. CodeMirror only
 * renders the lines in view, and a story is longer than the pane.
 */
async function revealLine(page: Page, match: RegExp): Promise<void> {
  await page.locator(".cm-scroller").evaluate((el) => (el.scrollTop = 0));
  for (let i = 0; i < 60; i++) {
    if (await page.locator(".cm-line", { hasText: match }).count()) return;
    await page.locator(".cm-scroller").evaluate((el) => (el.scrollTop += 150));
    await page.waitForTimeout(50);
  }
  throw new Error(`no editor line matches ${match}`);
}

/** Replace one line's text (after its indentation) the way a keyboard does. */
async function rewriteLine(page: Page, match: RegExp, text: string): Promise<void> {
  await revealLine(page, match);
  await page.locator(".cm-line", { hasText: match }).first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.insertText(text);
}

test.describe("playground at 1280×800", () => {
  test.use({ viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] });

  test("edit → re-render with the camera kept; a mistake keeps the last map; the quick fix repairs it", async ({ page }) => {
    requireBuild();
    const errors = await guard(page);
    await open(page, "?src=/configs/earthquakes.yaml", "earthquakes");
    await expect(page.locator("#pg-status")).toHaveAttribute("data-state", "ok");
    await expect(page.locator("#pg-status-text")).toHaveText("Map updated · no problems");
    await expect(page.locator("#pg-starter")).toHaveValue("/configs/earthquakes.yaml");

    // The reader pans; then edits a colour. The map redraws, and stays put.
    await page.evaluate((sel) => (document.querySelector(sel) as any).getMap().jumpTo({ center: [139.7, 35.7], zoom: 4 }), MAP);
    const before = await renders(page);
    await rewriteLine(page, /circle-color:/, 'circle-color: "#2563eb"');
    await expect.poll(() => renders(page)).toBeGreaterThan(before);
    await waitForLayer(page, "earthquakes", "#2563eb");
    const kept = await camera(page);
    expect(kept.lng).toBeCloseTo(139.7, 3);
    expect(kept.lat).toBeCloseTo(35.7, 3);
    expect(kept.zoom).toBeCloseTo(4, 3);

    // Editing the view itself moves the camera to the new view.
    const beforeZoom = await renders(page);
    await rewriteLine(page, /^\s*zoom:/, "zoom: 2");
    await expect.poll(() => renders(page)).toBeGreaterThan(beforeZoom);
    await waitForLayer(page, "earthquakes");
    await expect.poll(async () => (await camera(page)).zoom).toBeCloseTo(2, 3);

    // A mistake: underlined, counted, and the last working map stays up.
    const rendered = await renders(page);
    await rewriteLine(page, /^\s*zoom:/, "zom: 2");
    await page.keyboard.press("ArrowUp"); // leave the line: errors show at once
    await expect(page.locator("#pg-status")).toHaveAttribute("data-state", "error");
    await expect(page.locator("#pg-status-text")).toContainText("1 error");
    await expect(page.locator("#pg-status-text")).toContainText("last working version");
    await expect(page.locator(".cm-lintRange-error")).toHaveCount(1);
    await expect(page.locator(".cm-lintRange-error")).toHaveText("zom");
    await expect(page.locator("#pg-stale")).toBeVisible();
    expect(await renders(page)).toBe(rendered);
    await expect(page.locator(MAP)).toBeVisible();

    // The status line jumps to the problem; the quick fix makes the change.
    await page.locator("#pg-status-btn").click();
    const fix = page.locator(".cm-panel-lint .cm-diagnosticAction", { hasText: "Change to zoom" });
    await expect(fix).toBeVisible();
    await fix.click();
    await expect(page.locator("#pg-status")).toHaveAttribute("data-state", "ok");
    await expect(page.locator("#pg-stale")).toBeHidden();
    expect(await docText(page)).toMatch(/^\s+zoom: 2$/m);
    // The fixed text is the text the map already shows: no rebuild.
    expect(await renders(page)).toBe(rendered);

    // The status line is announced politely, and says more than its colour.
    await expect(page.locator("#pg-status-text")).toHaveAttribute("aria-live", "polite");
    await expect(page.locator(".cm-content")).toHaveAttribute("aria-label", "Map document (YAML)");
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("schema completion offers the keys that fit, and Esc then Tab leaves the editor", async ({ page }) => {
    requireBuild();
    const errors = await guard(page);
    await open(page, "?src=/configs/earthquakes.yaml", "earthquakes");
    await page.locator(".cm-line", { hasText: /^\s*zoom:/ }).first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("pi");
    const list = page.locator(".cm-tooltip-autocomplete");
    await expect(list).toBeVisible();
    await expect(list.locator(".cm-completionLabel").first()).toHaveText("pitch");
    // CodeMirror ignores Enter for 75 ms after the list opens (interactionDelay).
    await page.waitForTimeout(150);
    await page.keyboard.press("Enter");
    expect(await docText(page)).toMatch(/^\s+pitch: $/m);

    // Tab indents (YAML needs it); Escape then Tab moves focus on.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    await expect(page.locator(".cm-content")).not.toBeFocused();
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });

  test("a share link reopens the same document, with the sites it names", async ({ page, context }) => {
    requireBuild();
    const errors = await guard(page);
    await open(page, "?src=/configs/earthquakes.yaml", "earthquakes");
    // Raw HTML in a document is a teaching note in the editor, never markup.
    // The popup is at the end of the document: scroll there first
    // (CodeMirror only draws the lines in view).
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await rewriteLine(page, /- property: place/, '- str: !html "<b id=\'pwn\'>bold</b>"');
    await expect(page.locator(".cm-lintRange-info")).toHaveCount(1);
    await expect(page.locator("#pg-status")).toHaveAttribute("data-state", "ok");
    const written = await docText(page);

    await page.locator("#pg-share-btn").click();
    await expect(page.locator("#pg-message")).toHaveText(/Link copied\.|The link is in the address bar\./);
    const link = page.url();
    expect(link).toMatch(/\/playground\/#code\/[A-Za-z0-9+\-$]+$/);

    const shared = await context.newPage();
    const sharedErrors = await guard(shared);
    await open(shared, link.slice(link.indexOf("#")), "earthquakes");
    expect(await docText(shared)).toBe(written);
    await expect(shared.locator("#pg-shared")).toBeVisible();
    await expect(shared.locator("#pg-shared-hosts")).toHaveText("earthquake.usgs.gov, tiles.openfreemap.org");
    await expect(shared.locator("#pg-starter")).toHaveValue("");
    // Click a quake: the popup shows the markup as text, and no element is made.
    const point = await shared.evaluate((sel) => {
      const el = document.querySelector(sel) as any;
      const p = el.getMap().project([-120, 37]);
      const box = el.getBoundingClientRect();
      return { x: box.left + p.x, y: box.top + p.y };
    }, MAP);
    await shared.mouse.click(point.x, point.y);
    const popup = shared.locator(".maplibregl-popup-content");
    await expect(popup).toContainText("<b id='pwn'>bold</b>");
    expect(await shared.locator("#pwn").count()).toBe(0);
    expect([...errors, ...sharedErrors], `page errors:\n${[...errors, ...sharedErrors].join("\n")}`).toEqual([]);
  });

  test("Download saves a folder that works: page, document and README", async ({ page }) => {
    requireBuild();
    const errors = await guard(page);
    await open(page, "?src=/configs/classify/graduated.yaml", "cities");
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#pg-download-btn").click()]);
    expect(download.suggestedFilename()).toBe("my-map.zip");
    const files = unzipSync(readFileSync(await download.path()));
    expect(Object.keys(files).sort()).toEqual(["my-map/README.txt", "my-map/index.html", "my-map/map.yaml"]);
    const minor = JSON.parse(readFileSync(join(REPO, "packages/core/package.json"), "utf8")).version.split(".").slice(0, 2).join(".");
    const html = strFromU8(files["my-map/index.html"]);
    expect(html).toContain(`https://unpkg.com/@maplibre-yaml/core@${minor}/register.js`);
    expect(html).toContain('<ml-map src="./map.yaml"></ml-map>');
    const yaml = strFromU8(files["my-map/map.yaml"]);
    expect(yaml).toContain("url: https://docs.maplibre-yaml.org/data/classify/world-cities.geojson");
    expect(yaml.replace("https://docs.maplibre-yaml.org/data/", "/data/")).toBe(await docText(page));
    expect(strFromU8(files["my-map/README.txt"])).toContain("npx serve .");
    await expect(page.locator("#pg-message")).toContainText("my-map.zip");
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});

test.describe("playground story map at 1280×800", () => {
  test.use({ viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] });

  test("the story starter: rail and legend, edits re-render, scrolling moves the map, share and download", async ({ page, context }) => {
    requireBuild();
    const errors = await guard(page);
    await open(page, "");
    // "Start here" lists the story map near the top.
    const curated = await page.locator('#pg-starter optgroup[label="Start here"] option').allTextContents();
    expect(curated.indexOf("A story map: a week of earthquakes")).toBeGreaterThanOrEqual(0);
    expect(curated.indexOf("A story map: a week of earthquakes")).toBeLessThanOrEqual(1);
    await page.locator("#pg-starter").selectOption({ label: "A story map: a week of earthquakes" });
    await expect(page.locator(".pg-root")).toHaveAttribute("data-kind", "scrollytelling");
    await expect(page.locator("#pg-starter")).toHaveValue(STORY_SRC);
    expect(page.url()).toContain(`?src=${STORY_SRC}`);
    await waitForStoryLayer(page, "quakes");
    await expect(page.locator("#pg-status")).toHaveAttribute("data-state", "ok");

    // Four chapters, the chapter rail with a dot each, and the legend.
    await expect(page.locator(`${STORY} .scrolly-chapter`)).toHaveCount(4);
    await expect(page.locator(`${STORY} .chapter-markers > *`)).toHaveCount(4);
    await expect(page.locator(`${STORY} .scrolly-legend`)).toHaveCount(1);
    await expect(page.locator(`${STORY} .scrolly-legend`)).toContainText("6 or more");
    // On desktop the story shows in the pane: no "Preview the story" gate.
    await expect(page.locator("#pg-story-gate")).toBeHidden();

    // Edit a chapter: its card changes; the rail keeps a dot per chapter.
    let before = await renders(page);
    await rewriteLine(page, /title: "Japan"/, 'title: "Japan and its trenches"');
    await expect.poll(() => renders(page)).toBeGreaterThan(before);
    await expect(page.locator(`${STORY} .scrolly-chapter[data-chapter-id="japan"]`)).toContainText("Japan and its trenches");
    await expect(page.locator(`${STORY} .chapter-markers > *`)).toHaveCount(4);
    await waitForStoryLayer(page, "quakes");

    // Edit the legend: the legend is rebuilt from the new document.
    before = await renders(page);
    await rewriteLine(page, /label: "6 or more"/, '- { color: "#dc2626", label: "Six or more", shape: circle }');
    await expect.poll(() => renders(page)).toBeGreaterThan(before);
    await expect(page.locator(`${STORY} .scrolly-legend`)).toContainText("Six or more");
    await expect(page.locator(`${STORY} .scrolly-legend`)).not.toContainText("6 or more");
    await waitForStoryLayer(page, "quakes");
    await expect(page.locator("#pg-status")).toHaveAttribute("data-state", "ok");

    // Scrolling the pane makes the Japan chapter active and flies the map there.
    await page.locator(`${STORY} .scrolly-chapter[data-chapter-id="japan"]`).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await expect(page.locator(STORY)).toHaveAttribute("data-active-chapter", "japan");
    await expect
      .poll(() => page.evaluate((sel) => (document.querySelector(`${sel} ml-map`) as any).getMap().getCenter().lng, STORY), { timeout: 30_000 })
      .toBeCloseTo(138, 0);
    const written = await docText(page);

    // Share: the link reopens the same story, edits included.
    await page.locator("#pg-share-btn").click();
    await expect(page.locator("#pg-message")).toHaveText(/Link copied\.|The link is in the address bar\./);
    const link = page.url();
    expect(link).toMatch(/\/playground\/#code\/[A-Za-z0-9+\-$]+$/);
    const shared = await context.newPage();
    const sharedErrors = await guard(shared);
    await open(shared, link.slice(link.indexOf("#")));
    expect(await docText(shared)).toBe(written);
    await expect(shared.locator(".pg-root")).toHaveAttribute("data-kind", "scrollytelling");
    await expect(shared.locator(`${STORY} .scrolly-chapter[data-chapter-id="japan"]`)).toContainText("Japan and its trenches");
    await expect(shared.locator(`${STORY} .scrolly-legend`)).toContainText("Six or more");
    await expect(shared.locator("#pg-shared-hosts")).toHaveText("earthquake.usgs.gov, tiles.openfreemap.org");
    // A shared story opens on its first chapter.
    expect(await shared.locator("#pg-preview").evaluate((el) => el.scrollTop)).toBe(0);

    // Download: story.yaml and a page that shows it with <ml-scrollytelling>.
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#pg-download-btn").click()]);
    expect(download.suggestedFilename()).toBe("my-map.zip");
    const files = unzipSync(readFileSync(await download.path()));
    expect(Object.keys(files).sort()).toEqual(["my-map/README.txt", "my-map/index.html", "my-map/story.yaml"]);
    const minor = JSON.parse(readFileSync(join(REPO, "packages/core/package.json"), "utf8")).version.split(".").slice(0, 2).join(".");
    const html = strFromU8(files["my-map/index.html"]);
    expect(html).toContain(`https://unpkg.com/@maplibre-yaml/core@${minor}/register.js`);
    expect(html).toContain('<ml-scrollytelling src="story.yaml"></ml-scrollytelling>');
    expect(html).not.toContain("<ml-map src");
    // The story's URLs are already absolute: the file is the document as written.
    expect(strFromU8(files["my-map/story.yaml"])).toBe(written.endsWith("\n") ? written : `${written}\n`);
    expect(strFromU8(files["my-map/README.txt"])).toContain("story.yaml");

    // Another story, opened while this one is scrolled down, starts at its
    // first chapter rather than wherever the pane was.
    expect(await page.locator("#pg-preview").evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await page.locator("#pg-starter").selectOption("/configs/gallery/fly-to-a-location-based-on-scroll-position.yaml");
    await expect(page.locator(`${STORY} .scrolly-chapter`)).toHaveCount(8);
    expect(await page.locator("#pg-preview").evaluate((el) => el.scrollTop)).toBe(0);
    await expect(page.locator(STORY)).toHaveAttribute("data-active-chapter", "baker");
    expect([...errors, ...sharedErrors], `page errors:\n${[...errors, ...sharedErrors].join("\n")}`).toEqual([]);
  });

  test("the header links to Examples and the Playground, after search and before GitHub", async ({ page }) => {
    requireBuild();
    const errors = await guard(page);
    await open(page, "?src=/configs/earthquakes.yaml", "earthquakes");
    const nav = page.locator('header .right-group nav[aria-label="Site"]');
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "Examples" })).toHaveAttribute("href", "/examples/");
    await expect(nav.getByRole("link", { name: "Playground" })).toHaveAttribute("aria-current", "page");
    // Keyboard order: search, Examples, Playground, GitHub, theme.
    await page.locator("header button[data-open-modal]").focus();
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => document.activeElement?.textContent?.trim().replace(/\s+/g, " ") ?? ""));
    }
    expect(order.slice(0, 3)).toEqual(["Examples", "Playground", "GitHub"]);
    // No phone menu on desktop.
    await expect(page.locator("site-menu summary")).toBeHidden();
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});

test.describe("playground at 390×844 (phone)", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

  test("the map sits above the editor; a story map opens full height and comes back", async ({ page }) => {
    requireBuild();
    const errors = await guard(page);
    await open(page, "?src=/configs/earthquakes.yaml", "earthquakes");
    const map = (await page.locator("#pg-preview").boundingBox())!;
    const code = (await page.locator("#pg-editor").boundingBox())!;
    expect(map.width).toBeGreaterThan(380);
    expect(code.width).toBeGreaterThan(380);
    expect(map.y + map.height).toBeLessThanOrEqual(code.y + 1);
    expect(map.height).toBeGreaterThan(250);
    expect(code.height).toBeGreaterThan(250);
    // 16px editor text: iOS doesn't zoom the page when the editor takes focus.
    expect(await page.locator(".cm-content").evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    // Controls are big enough to tap.
    for (const id of ["#pg-share-btn", "#pg-download-btn", "#pg-swap", "#pg-starter"]) {
      expect((await page.locator(id).boundingBox())!.height, id).toBeGreaterThanOrEqual(32);
    }
    await page.locator("#pg-swap").tap();
    await expect(page.locator("#pg-swap")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await page.locator("#pg-preview").boundingBox())!.height).toBeGreaterThan(map.height + 100);

    // A story map: the pane offers a full-height preview.
    await page.locator("#pg-starter").selectOption(STORY_SRC);
    await expect(page.locator(".pg-root")).toHaveAttribute("data-kind", "scrollytelling");
    await expect(page.locator("#pg-story-gate")).toBeVisible();
    await page.locator("#pg-story-open").tap();
    await expect(page.locator("#pg-back")).toBeVisible();
    await expect(page.locator("#pg-back")).toBeFocused();
    // The story fills the screen under a 3.5rem bar that holds "Back to code".
    const full = (await page.locator("#pg-preview").boundingBox())!;
    expect(full.y).toBe(56);
    expect(full.y + full.height).toBe(844);
    const back = (await page.locator("#pg-back").boundingBox())!;
    expect(back.y + back.height).toBeLessThanOrEqual(full.y);
    await expect(page.locator(`${STORY} .scrolly-chapter`)).toHaveCount(4);
    await waitForStoryLayer(page, "quakes");
    // The story's legend button (top-left) is not under "Back to code": it opens.
    const toggle = page.locator(`${STORY} .scrolly-legend-toggle`);
    await toggle.tap();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(`${STORY} .scrolly-legend`)).toContainText("6 or more");
    await page.locator("#pg-back").tap();
    await expect(page.locator("#pg-story-gate")).toBeVisible();
    await expect(page.locator("#pg-back")).toBeHidden();

    // This page has no sidebar, so no Starlight menu: the site menu carries
    // the header's links on a phone, and Escape closes it.
    await expect(page.locator('header .right-group nav[aria-label="Site"]')).toBeHidden();
    const menu = page.locator("site-menu summary");
    await expect(menu).toHaveAccessibleName("Site menu");
    await menu.tap();
    const panel = page.locator(".site-menu-panel");
    await expect(panel.getByRole("link", { name: "Examples" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Playground" })).toBeVisible();
    await expect(panel.getByRole("link", { name: "GitHub" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    expect(errors, `page errors:\n${errors.join("\n")}`).toEqual([]);
  });
});
