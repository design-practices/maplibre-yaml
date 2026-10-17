/**
 * `<ml-scrollytelling>` in plain HTML (ml-aot.1) -- browser verification,
 * which is also the demo.
 *
 * @remarks
 * The pages under test are `examples/scrollytelling/` (served by the e2e
 * server, loading the local build through an import map) and the docs'
 * plain-HTML quick start, read VERBATIM out of the `.mdx` and served with its
 * CDN URLs mapped onto the local build, as e2e/docs-getting-started.spec.ts
 * does. What only a real browser proves: chapters activate as the reader
 * scrolls, the camera lands where the document says, actions apply, the
 * wheel scrolls the story rather than zooming the map, the rail is
 * clickable with a real mouse (ml-07q) and by keyboard, the mobile layout
 * keeps the chapter's subject out from under its card (ml-aot.8), fitBounds
 * frames top-down after a tilted chapter (ml-aot.9), reduced motion is
 * instant (ml-cxk), a slow `src` never shows `<ml-map>`'s "No configuration
 * provided" (ml-4al), and a broken story shows exactly one error card
 * (ml-aot.7).
 *
 * Hermetic: the demotiles basemap URL is answered with the local fixture
 * style; any other off-origin request fails the test.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const EXAMPLE = "/examples/scrollytelling/index.html";
const INLINE = "/examples/scrollytelling/inline.html";
const LOCAL_STYLE = "/examples/verification/configs/local-style.json";

/** Collect page errors; serve the basemap locally; fail other off-origin requests. */
async function guard(page: Page, baseURL: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.route("**/*", async (route: Route) => {
    const url = route.request().url();
    if (url === "https://demotiles.maplibre.org/style.json") {
      return route.fulfill({ response: await page.request.fetch(`${baseURL}${LOCAL_STYLE}`) });
    }
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || url.startsWith("data:")) {
      return route.continue();
    }
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

/** Wait for the story's map to load, its volcano layer to hold features. */
async function storyReady(page: Page, layer = "volcanoes"): Promise<void> {
  await page.waitForFunction(() => typeof (document.querySelector("ml-scrollytelling") as any)?.mapReady === "function");
  await page.evaluate(() => (document.querySelector("ml-scrollytelling") as any).mapReady().then(() => null));
  await expect
    .poll(() =>
      page.evaluate((id) => {
        const map = (document.querySelector("ml-scrollytelling") as any).getMap();
        const l = map?.getLayer(id);
        return l ? map.querySourceFeatures(l.source).length : -1;
      }, layer)
    )
    .toBeGreaterThan(0);
}

/** Evaluate an expression against the story's MapLibre map. */
const onMap = <T>(page: Page, body: string): Promise<T> =>
  page.evaluate(
    (b) => new Function("map", `return (${b})`)((document.querySelector("ml-scrollytelling") as any).getMap()),
    body
  ) as Promise<T>;

const active = (page: Page) =>
  page.evaluate(() => (document.querySelector("ml-scrollytelling") as HTMLElement).dataset.activeChapter ?? null);

/** Scroll (as a reader would) until the chapter's card is mid-screen, and wait for it. */
async function scrollToChapter(page: Page, id: string, wheel = false): Promise<void> {
  for (let i = 0; i < 80; i++) {
    const d = await page.evaluate((chapterId) => {
      const s = document.querySelector(`.scrolly-chapter[data-chapter-id="${chapterId}"]`)!;
      const c = (s.querySelector(".chapter-content") ?? s).getBoundingClientRect();
      return c.top + c.height / 2 - innerHeight / 2;
    }, id);
    if (Math.abs(d) < 40) break;
    const step = Math.max(-400, Math.min(400, d));
    if (wheel) await page.mouse.wheel(0, step);
    else await page.evaluate((y) => scrollBy(0, y), step);
    await page.waitForTimeout(60);
  }
  await expect.poll(() => active(page), { message: `chapter ${id} active` }).toBe(id);
}

/** Wait until the map has stopped moving. */
const settled = (page: Page) =>
  expect.poll(() => onMap<boolean>(page, "map.isMoving()"), { message: "camera settles" }).toBe(false);

async function expectCameraNear(page: Page, [lng, lat]: [number, number], zoom?: number, tol = 0.5) {
  await expect
    .poll(async () => {
      const c = await onMap<{ lng: number; lat: number; zoom: number }>(
        page,
        "({ ...map.getCenter().wrap(), zoom: map.getZoom() })"
      );
      const dLng = Math.abs(((c.lng - lng + 540) % 360) - 180);
      const ok = dLng < tol && Math.abs(c.lat - lat) < tol && (zoom === undefined || Math.abs(c.zoom - zoom) < 0.2);
      return ok ? "near" : JSON.stringify(c);
    }, { message: `camera near [${lng}, ${lat}]${zoom === undefined ? "" : ` z${zoom}`}` })
    .toBe("near");
}

test.describe("<ml-scrollytelling src> in a plain page", () => {
  test("scrolling activates chapters, lands the camera and runs every action kind", async ({ page, baseURL }) => {
    const errors = await guard(page, baseURL!);
    await page.goto(EXAMPLE, { waitUntil: "domcontentloaded" });
    await storyReady(page);
    const story = page.locator("ml-scrollytelling");
    await expect(story.locator(".scrolly-chapter")).toHaveCount(6);
    await expect(story).toHaveClass(/scrollytelling-container/);
    await expect(story).toHaveClass(/theme-dark/);

    // Reading starts: the first chapter activates as the story scrolls in.
    await scrollToChapter(page, "intro", true);
    await expectCameraNear(page, [160, 10], 1.5);

    const chapters: string[] = [];
    await page.evaluate(() => {
      (window as any).__chapters = [];
      document.querySelector("ml-scrollytelling")!.addEventListener("ml-scrollytelling:chapter", (e: any) =>
        (window as any).__chapters.push(e.detail.chapterId)
      );
    });

    // camera (pitched) + setPaintProperty + setFilter on enter
    await scrollToChapter(page, "japan", true);
    await settled(page);
    await expectCameraNear(page, [137, 35], 5);
    expect(await onMap<number>(page, "Math.round(map.getPitch())")).toBe(45);
    expect(await onMap(page, `map.getPaintProperty("volcanoes", "circle-color")`)).toBe("#ef4444");
    expect(await onMap(page, `map.getFilter("volcanoes")`)).toEqual([">=", ["get", "elevation"], 2500]);

    // onChapterExit resets them; layers.show turns the arc on
    await scrollToChapter(page, "andes");
    await settled(page);
    await expectCameraNear(page, [-75, -20], 3);
    expect(await onMap(page, `map.getFilter("volcanoes") ?? null`)).toBeNull();
    expect(await onMap(page, `map.getPaintProperty("volcanoes", "circle-color")`)).toBe("#fbbf24");
    expect(await onMap(page, `map.getLayoutProperty("arc", "visibility")`)).toBe("visible");
    expect(await onMap<number>(page, "Math.round(map.getPitch())")).toBe(40);

    // ml-aot.9: fitBounds after a tilted chapter frames top-down
    await scrollToChapter(page, "pacific");
    await settled(page);
    expect(await onMap<number>(page, "Math.round(map.getPitch())")).toBe(0);
    expect(await onMap<number>(page, "Math.round(map.getBearing())")).toBe(0);
    expect(await onMap<number>(page, "map.getZoom()")).toBeLessThan(2.5);

    // custom action -> page event -> banner
    await scrollToChapter(page, "tonga");
    await expect(page.locator("#banner")).toHaveText("Pressure wave circled the globe four times");

    // layers.hide
    await scrollToChapter(page, "outro");
    await expect.poll(() => onMap(page, `map.getLayoutProperty("arc", "visibility")`)).toBe("none");
    expect(await page.evaluate(() => (window as any).__chapters)).toEqual([
      "japan",
      "andes",
      "pacific",
      "tonga",
      "outro",
    ]);

    // The story sits inside an ordinary page: past its end the article shows,
    // with the map no longer over it.
    await page.locator("#after").scrollIntoViewIfNeeded();
    const after = await page.locator("#after").boundingBox();
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest("#after") !== null,
      [after!.x + 20, after!.y + 20]
    );
    expect(hit).toBe(true);
    expect(errors).toEqual([]);
  });

  test("the wheel over the map scrolls the story; links in chapters are clickable", async ({ page, baseURL }) => {
    const errors = await guard(page, baseURL!);
    await page.goto(EXAMPLE, { waitUntil: "domcontentloaded" });
    await storyReady(page);
    await scrollToChapter(page, "intro");
    await settled(page);

    const before = await page.evaluate(() => scrollY);
    const zoom = await onMap<number>(page, "map.getZoom()");
    // Bottom-right of the map, clear of the card: the wheel lands on the map canvas.
    await page.mouse.move(1180, 650);
    expect(await page.evaluate(() => document.elementFromPoint(1180, 650)?.classList.contains("maplibregl-canvas"))).toBe(true);
    // A short turn of the wheel: the page scrolls, the same chapter stays
    // active, and the map does not zoom.
    await page.mouse.wheel(0, 120);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 100);
    await page.waitForTimeout(300);
    expect(await active(page)).toBe("intro");
    expect(await onMap<number>(page, "map.getZoom()")).toBeCloseTo(zoom, 5);
    expect(await onMap<boolean>(page, "map.scrollZoom.isEnabled()")).toBe(false);

    // The chapter's link is the top element at its centre (not covered).
    await scrollToChapter(page, "intro");
    const link = page.locator("#intro-link");
    const box = (await link.boundingBox())!;
    expect(
      await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [box.x + box.width / 2, box.y + box.height / 2])
    ).toBe("intro-link");
    // The chapter image loaded.
    expect(await page.locator(".scrolly-chapter img").first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("the rail: a real mouse click on a dot goes to its chapter (ml-07q)", async ({ page, baseURL }) => {
    const errors = await guard(page, baseURL!);
    await page.goto(EXAMPLE, { waitUntil: "domcontentloaded" });
    await storyReady(page);
    await scrollToChapter(page, "intro");

    // Every dot is the top element at its own centre (nothing covers it).
    const covered = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".chapter-marker")]
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) !== b;
        })
        .map((b) => b.dataset.chapterId)
    );
    expect(covered).toEqual([]);

    // page.mouse.click, not dispatchEvent: the hit test is the point.
    const dot = (await page.locator('.chapter-marker[data-chapter-id="andes"]').boundingBox())!;
    await page.mouse.click(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await expect.poll(() => active(page)).toBe("andes");
    await expect(page.locator('.chapter-marker[data-chapter-id="andes"]')).toHaveAttribute("aria-current", "step");
    await settled(page);
    await expectCameraNear(page, [-75, -20], 3);
    // It also scrolled there: the andes card is on screen.
    const card = (await page.locator('.scrolly-chapter[data-chapter-id="andes"] .chapter-content').boundingBox())!;
    expect(card.y).toBeGreaterThan(-card.height);
    expect(card.y).toBeLessThan(800);

    // A long jump (last chapter -> first) lands on the target and skips every
    // chapter it scrolls past, however fast the smooth scroll goes.
    await scrollToChapter(page, "outro");
    await page.evaluate(() => {
      (window as any).__jump = [];
      document.querySelector("ml-scrollytelling")!.addEventListener("ml-scrollytelling:chapter", (e: any) =>
        (window as any).__jump.push(e.detail.chapterId)
      );
    });
    const first = (await page.locator('.chapter-marker[data-chapter-id="intro"]').boundingBox())!;
    await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2);
    await expect.poll(() => active(page)).toBe("intro");
    await page.waitForTimeout(2500); // let the smooth scroll finish
    expect(await active(page)).toBe("intro");
    expect(await page.evaluate(() => (window as any).__jump)).toEqual(["intro"]);
    expect(errors).toEqual([]);
  });

  test("the rail by keyboard: Tab to a dot, arrows and Enter move through chapters", async ({ page, baseURL }) => {
    const errors = await guard(page, baseURL!);
    await page.goto(EXAMPLE, { waitUntil: "domcontentloaded" });
    await storyReady(page);
    await scrollToChapter(page, "intro");

    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(() => document.activeElement?.classList.contains("chapter-marker"))) break;
    }
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.chapterId)).toBe("intro");
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).dataset.chapterId)).toBe("japan");
    await expect.poll(() => active(page)).toBe("japan");
    await page.keyboard.press("End");
    await expect.poll(() => active(page)).toBe("outro");
    // Shift+Tab back onto a dot and Enter: the button's own activation.
    await page.keyboard.press("Home");
    await expect.poll(() => active(page)).toBe("intro");
    await page.locator('.chapter-marker[data-chapter-id="tonga"]').focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => active(page)).toBe("tonga");
    expect(errors).toEqual([]);
  });

  test("mobile: the chapter's subject shows above its card; the rail stays off the cards (ml-aot.8)", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const errors = await guard(page, baseURL!);
    await page.goto(EXAMPLE, { waitUntil: "domcontentloaded" });
    await storyReady(page);

    for (const [id, subject] of [
      ["japan", [138.7274, 35.3606]],
      ["tonga", [-175.382, -20.536]],
    ] as const) {
      await scrollToChapter(page, id);
      await settled(page);
      const layout = await page.evaluate(
        ([chapterId, lngLat]) => {
          const el = document.querySelector("ml-scrollytelling") as any;
          const map = el.getMap();
          const p = map.project(lngLat);
          const box = el.querySelector(".scrolly-map-container").getBoundingClientRect();
          const card = el
            .querySelector(`.scrolly-chapter[data-chapter-id="${chapterId}"] .chapter-content`)
            .getBoundingClientRect();
          const rail = [...el.querySelectorAll(".chapter-marker")].map((b: Element) => b.getBoundingClientRect());
          return {
            subject: { x: box.left + p.x, y: box.top + p.y },
            card: { left: card.left, right: card.right, top: card.top, bottom: card.bottom },
            railLeft: Math.min(...rail.map((r) => r.left)),
            scrollWidth: document.documentElement.scrollWidth,
          };
        },
        [id, subject] as const
      );
      // On screen, and above the card (not under it).
      expect(layout.subject.y, `${id}: subject y`).toBeGreaterThan(0);
      expect(layout.subject.y, `${id}: subject above the card`).toBeLessThan(layout.card.top);
      // The card fits the screen; the rail sits in its own gutter.
      expect(layout.card.left).toBeGreaterThanOrEqual(0);
      expect(layout.card.right).toBeLessThanOrEqual(390);
      expect(layout.railLeft, `${id}: rail clear of the card`).toBeGreaterThanOrEqual(layout.card.right);
      expect(layout.scrollWidth).toBeLessThanOrEqual(390);
    }
    expect(errors).toEqual([]);
    await context.close();
  });

  test("reduced motion: chapter camera moves are instant (ml-cxk)", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = await guard(page, baseURL!);
    await page.goto(EXAMPLE, { waitUntil: "domcontentloaded" });
    await storyReady(page);
    await scrollToChapter(page, "intro");
    await settled(page);

    // Jump straight to a far chapter; 150 ms later the camera is already there.
    await page.evaluate(() => {
      const card = document.querySelector('.scrolly-chapter[data-chapter-id="andes"] .chapter-content')!;
      const r = card.getBoundingClientRect();
      scrollBy(0, r.top + r.height / 2 - innerHeight / 2);
    });
    await expect.poll(() => active(page)).toBe("andes");
    await page.waitForTimeout(150);
    expect(await onMap<boolean>(page, "map.isMoving()")).toBe(false);
    await expectCameraNear(page, [-75, -20], 3, 0.01);
    // ... and the fitBounds action after it.
    await page.evaluate(() => {
      const card = document.querySelector('.scrolly-chapter[data-chapter-id="pacific"] .chapter-content')!;
      const r = card.getBoundingClientRect();
      scrollBy(0, r.top + r.height / 2 - innerHeight / 2);
    });
    await expect.poll(() => active(page)).toBe("pacific");
    await page.waitForTimeout(150);
    expect(await onMap<boolean>(page, "map.isMoving()")).toBe(false);
    expect(await onMap<number>(page, "Math.round(map.getPitch())")).toBe(0);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("a slow src never shows <ml-map>'s 'No configuration provided' (ml-4al)", async ({ page, baseURL }) => {
    const errors = await guard(page, baseURL!);
    await page.route("**/examples/scrollytelling/story.yaml", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      return route.continue();
    });
    await page.addInitScript(() => {
      (window as any).__mapErrors = [];
      document.addEventListener("ml-map:error", (e: any) => (window as any).__mapErrors.push(JSON.stringify(e.detail)));
    });
    await page.goto(EXAMPLE, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".chapters-loading")).toBeVisible();
    await storyReady(page);
    await expect(page.locator(".chapters-loading")).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__mapErrors)).toEqual([]);
    await expect(page.getByText("No configuration provided")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("a broken story shows one error card, with line numbers and the did-you-mean (ml-aot.7)", async ({
    page,
    baseURL,
  }) => {
    const errors = await guard(page, baseURL!);
    const broken = readFileSync(join(ROOT, "examples/scrollytelling/story.yaml"), "utf8").replace(
      "    center: [137, 35]",
      "    centre: [137, 35]"
    );
    await page.route("**/examples/scrollytelling/story.yaml", (route) =>
      route.fulfill({ body: broken, contentType: "text/yaml" })
    );
    await page.goto(EXAMPLE, { waitUntil: "domcontentloaded" });
    const card = page.locator(".scrolly-error");
    await expect(card).toBeVisible();
    await page.waitForTimeout(1000); // anything else that would appear has appeared
    await expect(page.locator(".scrolly-error, .ml-map-error")).toHaveCount(1);
    await expect(page.locator("ml-map")).toHaveCount(0);
    await expect(card).toHaveAttribute("role", "alert");
    await expect(card).toContainText("story.yaml");
    await expect(card).toContainText("chapters.1.center");
    await expect(card).toContainText(/line \d+/);
    await expect(card).toContainText(/centre[\s\S]*center/);
    // The failure is logged once, as an error, naming the file.
    expect(errors.filter((e) => /ml-scrollytelling/.test(e))).toHaveLength(1);
  });
});

test.describe("<ml-scrollytelling> with inline YAML", () => {
  test("renders from the script child; slot children reach the map's corner", async ({ page, baseURL }) => {
    const errors = await guard(page, baseURL!);
    await page.goto(INLINE, { waitUntil: "domcontentloaded" });
    await storyReady(page, "cities");
    await expect(page.locator(".scrolly-chapter")).toHaveCount(3);
    await expect(page.locator(".ml-map-chrome-bottom-right #caption")).toBeVisible();
    await scrollToChapter(page, "lagos");
    await scrollToChapter(page, "lima");
    await settled(page);
    await expectCameraNear(page, [-77.04, -12.05], 5);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The docs' plain-HTML page, verbatim
// ---------------------------------------------------------------------------

const DOCS = join(ROOT, "docs/src/content/docs");

/** Fenced code blocks of one language, in document order, de-indented. */
function fences(file: string, lang: string): string[] {
  const lines = readFileSync(join(DOCS, file), "utf8").split("\n");
  const out: string[] = [];
  let open: { indent: number; fence: string; lang: string; body: string[] } | null = null;
  for (const line of lines) {
    if (!open) {
      const m = line.match(/^(\s*)(`{3,})(\S*)/);
      if (m) open = { indent: m[1].length, fence: m[2], lang: m[3], body: [] };
    } else if (line.trim() === open.fence) {
      if (open.lang === lang) {
        const n = open.indent;
        out.push(open.body.map((l) => (l.slice(0, n).trim() === "" ? l.slice(n) : l)).join("\n") + "\n");
      }
      open = null;
    } else {
      open.body.push(line);
    }
  }
  return out;
}

/**
 * The CDN URLs the page names, mapped onto the local build. maplibre-gl's
 * entry is a module re-exporting the vendored one by ABSOLUTE URL: the vendor
 * shim imports `./maplibre-gl.mjs`, which, served under the unpkg URL, would
 * resolve back to itself.
 */
function cdn(baseURL: string): Record<string, string | { js: string }> {
  const vendor = `${baseURL}/vendor/maplibre-gl.esm.js`;
  return {
    "https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.css": `${baseURL}/vendor/maplibre-gl.css`,
    "https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.mjs": {
      js: `export * from "${vendor}";\nexport { default } from "${vendor}";\n`,
    },
    "https://unpkg.com/@maplibre-yaml/core/register.js": `${baseURL}/packages/core/register.js`,
    "https://unpkg.com/@maplibre-yaml/core/dist/register.browser.js": `${baseURL}/packages/core/dist/register.browser.js`,
    "https://demotiles.maplibre.org/style.json": `${baseURL}${LOCAL_STYLE}`,
  };
}

async function serveDocs(page: Page, baseURL: string, files: Record<string, string>): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  const table = cdn(baseURL);
  const prefix = `${baseURL}/__docs/story/`;
  await page.route("**/*", async (route: Route) => {
    const url = route.request().url();
    if (url.startsWith(prefix)) {
      const file = url.slice(prefix.length) || "index.html";
      if (!(file in files)) return route.fulfill({ status: 404, body: "not found" });
      return route.fulfill({
        body: files[file],
        contentType: file.endsWith(".html") ? "text/html; charset=utf-8" : "text/yaml; charset=utf-8",
      });
    }
    if (url in table) {
      const target = table[url]!;
      if (typeof target !== "string") return route.fulfill({ body: target.js, contentType: "text/javascript" });
      return route.fulfill({ response: await page.request.fetch(target) });
    }
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url)) return route.continue();
    errors.push(`URL not in the docs CDN table: ${url}`);
    return route.abort();
  });
  return errors;
}

test.describe("docs: Scrollytelling in plain HTML, run verbatim", () => {
  const PAGE = "integrations/scrollytelling-html.mdx";

  test("the quick start (index.html + story.yaml) is a working story", async ({ page, baseURL }) => {
    const [html, inlineHtml] = fences(PAGE, "html");
    const [yaml] = fences(PAGE, "yaml");
    expect(html).toContain('<ml-scrollytelling src="story.yaml">');
    for (const url of html.match(/https?:\/\/[^\s"'`<>)]+/g) ?? []) {
      expect(Object.keys(cdn(baseURL!)), `unknown URL ${url}`).toContain(url);
    }
    const errors = await serveDocs(page, baseURL!, { "index.html": html, "story.yaml": yaml });
    await page.goto("/__docs/story/", { waitUntil: "domcontentloaded" });
    await storyReady(page, "cities");
    await expect(page.locator(".scrolly-chapter")).toHaveCount(3);
    await expect(page.locator(".chapter-marker")).toHaveCount(3);
    await scrollToChapter(page, "lagos");
    await scrollToChapter(page, "lima");
    await settled(page);
    await expectCameraNear(page, [-77.04, -12.05], 5);
    await scrollToChapter(page, "jakarta");
    await expect.poll(() => onMap(page, `map.getPaintProperty("cities", "circle-color")`)).toBe("#22c55e");
    await expect(page.locator(".scrolly-footer")).toContainText("Made with maplibre-yaml");
    expect(errors, errors.join("\n")).toEqual([]);

    // The inline-YAML variant, dropped into the same page in place of src.
    expect(inlineHtml).toContain('<script type="text/yaml">');
    const inlinePage = html.replace('<ml-scrollytelling src="story.yaml"></ml-scrollytelling>', inlineHtml);
    const errors2 = await serveDocs(page, baseURL!, { "index.html": inlinePage });
    await page.goto("/__docs/story/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => (document.querySelector("ml-scrollytelling") as any).mapReady().then(() => null));
    await expect(page.locator(".scrolly-chapter")).toHaveCount(2);
    await scrollToChapter(page, "start");
    await scrollToChapter(page, "europe");
    await settled(page);
    await expectCameraNear(page, [10, 50], 3.5);
    expect(errors2, errors2.join("\n")).toEqual([]);
  });
});
