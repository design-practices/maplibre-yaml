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
import { readFileSync, mkdirSync } from "node:fs";
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

  /**
   * The active chapter is always the one being read (ml-aot.44, ml-aot.45):
   * the chapter whose card is on screen and nearest the middle of it.
   * Scrolling back a little and forward again near a boundary used to leave
   * the previous chapter active; on phones the map moved on while the new
   * card was still below the screen.
   */
  async function readingState(page: Page) {
    return page.evaluate(() => {
      const el = document.querySelector("ml-scrollytelling") as HTMLElement;
      const h = innerHeight;
      const cards = [...el.querySelectorAll<HTMLElement>(".scrolly-chapter")].map((s) => {
        const c = (s.querySelector(".chapter-content") ?? s).getBoundingClientRect();
        return { id: s.dataset.chapterId!, top: c.top, bottom: c.bottom, mid: (c.top + c.bottom) / 2 };
      });
      const onScreen = cards.filter((c) => c.bottom > 0 && c.top < h);
      const nearest = [...onScreen].sort((a, b) => Math.abs(a.mid - h / 2) - Math.abs(b.mid - h / 2))[0];
      const active = el.dataset.activeChapter ?? null;
      return {
        active,
        nearest: nearest?.id ?? null,
        // Ties (two cards equally far from the middle) may go either way.
        tie: onScreen.filter((c) => Math.abs(Math.abs(c.mid - h / 2) - Math.abs(nearest.mid - h / 2)) < 3).length > 1,
        activeOnScreen: onScreen.some((c) => c.id === active),
        scrollY: Math.round(scrollY),
      };
    });
  }

  const settle = (page: Page) =>
    page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120)))));

  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    test(`back-and-forth scrolling always leaves the chapter being read active, ${viewport.width}x${viewport.height} (ml-aot.44/45)`, async ({
      browser,
      baseURL,
    }) => {
      const mobile = viewport.width < 768;
      const context = await browser.newContext({ viewport, reducedMotion: "reduce", isMobile: mobile, hasTouch: mobile });
      const page = await context.newPage();
      const errors = await guard(page, baseURL!);
      await page.goto(EXAMPLE, { waitUntil: "domcontentloaded" });
      await storyReady(page);
      const top = await page.evaluate(
        () => (document.querySelector("ml-scrollytelling") as HTMLElement).getBoundingClientRect().top + scrollY
      );
      const end = await page.evaluate(
        () => (document.querySelector(".scrolly-footer, .scrolly-chapter:last-child") as HTMLElement).getBoundingClientRect().top + scrollY
      );

      // A deterministic walk: forward steps of several sizes with small
      // corrections back (a trackpad overshooting and correcting).
      const steps = [180, -70, 260, -120, 90, -40, 330, -150, 60, 210, -95, 140, -30, 400, -200, 75];
      let y = top;
      const wrong: string[] = [];
      for (let i = 0; y < end && i < 200; i++) {
        y = Math.max(top, y + steps[i % steps.length]!);
        await page.evaluate((to) => scrollTo(0, to), y);
        await settle(page);
        const s = await readingState(page);
        if (s.nearest === null) continue;
        if (!s.tie && (s.active !== s.nearest || !s.activeOnScreen)) {
          wrong.push(`at ${s.scrollY}: active ${s.active}, reading ${s.nearest}`);
        }
      }
      expect(wrong, wrong.join("\n")).toEqual([]);

      // The bead's sequence: boundary between two chapters at 30% → 50% →
      // 30% → 10% of the screen must end on the later chapter.
      const boundary = await page.evaluate(() => {
        const s = document.querySelector<HTMLElement>('.scrolly-chapter[data-chapter-id="andes"]')!;
        return s.getBoundingClientRect().top + scrollY;
      });
      for (const at of [0.3, 0.5, 0.3, 0.1]) {
        await page.evaluate(([b, f]) => scrollTo(0, b - innerHeight * f), [boundary, at] as const);
        await settle(page);
      }
      const final = await readingState(page);
      expect(final.active).toBe(final.nearest);
      expect(errors).toEqual([]);
      await context.close();
    });
  }

  test("a fitBounds action under a tall centred card still frames its bounds (review A3)", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = await guard(page, baseURL!);
    const warnings: string[] = [];
    page.on("console", (m) => warnings.push(m.text()));
    await page.goto("/examples/verification/story-layout/index.html?doc=fitbounds", { waitUntil: "domcontentloaded" });
    await storyReady(page, "pts");
    await scrollToChapter(page, "frame");
    await settled(page);
    const state = await page.evaluate(() => {
      const el = document.querySelector("ml-scrollytelling") as any;
      const map = el.getMap();
      const card = el.querySelector('.scrolly-chapter[data-chapter-id="frame"] .chapter-content').getBoundingClientRect();
      const box = el.querySelector(".scrolly-map-container").getBoundingClientRect();
      const p = (at: [number, number]) => {
        const q = map.project(at);
        return { x: box.left + q.x, y: box.top + q.y };
      };
      return { a: p([10, 40]), b: p([30, 50]), cardHeight: card.height, center: map.getCenter() };
    });
    expect(state.cardHeight, "fixture drifted: the centred card should be ~330px").toBeGreaterThan(250);
    for (const pt of [state.a, state.b]) {
      expect(pt.x).toBeGreaterThan(0);
      expect(pt.x).toBeLessThan(1280);
      expect(pt.y).toBeGreaterThan(0);
      expect(pt.y).toBeLessThan(720);
    }
    expect(state.center.lng, "camera never left the chapter's own center").toBeGreaterThan(0);
    expect(warnings.filter((w) => /cannot fit/i.test(w))).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  });

  // ---------------------------------------------------------------------
  // The story's legend: pinned above the cards, a button on phones (0.8.1
  // maintainer decision: nothing on the map moves with the scroll).
  // ---------------------------------------------------------------------

  const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  const PHONE_SIDE = { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true };
  const DESK = { viewport: { width: 1280, height: 800 } };
  const LAPTOP = { viewport: { width: 1366, height: 768 } };

  /** The legend's toggle and panel, and what the screen shows at their centres. */
  const legendState = (page: Page) =>
    page.evaluate(() => {
      const el = document.querySelector("ml-scrollytelling") as HTMLElement;
      const root = el.querySelector<HTMLElement>(".scrolly-legend")!;
      const toggle = root.querySelector<HTMLButtonElement>(".scrolly-legend-toggle")!;
      const panel = root.querySelector<HTMLElement>(".scrolly-legend-panel")!;
      const t = toggle.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const map = el.querySelector(".scrolly-map-container")!.getBoundingClientRect();
      const topAt = (r: DOMRect) => document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const open = !panel.hidden;
      const hit = (a: DOMRect, b: DOMRect) =>
        a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      const cardsUnderPanel = open
        ? [...el.querySelectorAll<HTMLElement>(".chapter-content")]
            .filter((c) => c.getBoundingClientRect().height > 0 && hit(c.getBoundingClientRect(), p))
            .map((c) => c.closest<HTMLElement>(".scrolly-chapter")!.dataset.chapterId)
        : [];
      return {
        corner: root.dataset.corner,
        open,
        expanded: toggle.getAttribute("aria-expanded"),
        controls: toggle.getAttribute("aria-controls"),
        panelId: panel.id,
        toggle: [t.left, t.top, t.width, t.height].map((v) => Math.round(v)),
        mapTop: Math.round(map.top),
        toggleOnTop: root.contains(topAt(t)),
        panelOnTop: open ? root.contains(topAt(p)) : null,
        cardsUnderPanel,
        animation: getComputedStyle(panel).animationName,
        scrollY: Math.round(scrollY),
      };
    });

  /** The story-layout fixture `doc`, optionally with its YAML edited. */
  async function openLayout(page: Page, doc: string, edit?: (yaml: string) => string): Promise<void> {
    if (edit) {
      const file = join(ROOT, `examples/verification/story-layout/${doc}.yaml`);
      await page.route(`**/story-layout/${doc}.yaml`, (route) =>
        route.fulfill({ body: edit(readFileSync(file, "utf8")), contentType: "text/yaml" })
      );
    }
    await page.goto(`/examples/verification/story-layout/index.html?doc=${doc}`, { waitUntil: "domcontentloaded" });
    await storyReady(page, "pts");
    await page.waitForSelector(".scrolly-legend");
  }

  for (const [label, options, corner, open] of [
    ["phone", PHONE, "top-left", false],
    ["phone on its side", PHONE_SIDE, "top-right", false],
    ["desktop", DESK, "top-left", true],
    ["laptop", LAPTOP, "top-left", true],
  ] as const) {
    test(`the legend is pinned through the whole story, never under a card: ${label} (0.8.1 review)`, async ({
      browser,
      baseURL,
    }) => {
      const context = await browser.newContext({ ...options, reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = await guard(page, baseURL!);
      await openLayout(page, "legend");
      const ids = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".scrolly-chapter")].map((s) => s.dataset.chapterId!)
      );
      const first = await legendState(page);
      expect(first.corner).toBe(corner);
      expect(first.open, "open by default only where no card passes the corner").toBe(open);
      const h = options.viewport.height;
      const top = await page.evaluate(() => document.querySelector("ml-scrollytelling")!.getBoundingClientRect().top + scrollY);
      const end = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      const seen = new Set<string>();
      const bad: string[] = [];
      let home: number[] | null = null;
      for (let y = top; y <= end; y += Math.round(h / 6)) {
        await page.evaluate((to) => scrollTo(0, to), y);
        await settle(page);
        const s = await legendState(page);
        const id = await active(page);
        if (id) seen.add(id);
        if (s.mapTop !== 0) continue; // the map itself has scrolled away (story end)
        home ??= s.toggle;
        if (s.toggle.join() !== home.join()) bad.push(`at ${s.scrollY}: legend at ${s.toggle} (was ${home})`);
        if (!s.toggleOnTop) bad.push(`at ${s.scrollY}: something covers the legend button`);
        if (s.open && !s.panelOnTop) bad.push(`at ${s.scrollY}: something covers the open legend`);
        if (s.cardsUnderPanel.length) bad.push(`at ${s.scrollY}: the open legend covers ${s.cardsUnderPanel.join(",")}`);
      }
      expect(bad, bad.join("\n")).toEqual([]);
      expect([...seen].sort(), "the walk reached every chapter").toEqual([...ids].sort());
      await page.screenshot({ path: `e2e/results/story-legend-${options.viewport.width}x${options.viewport.height}.png` });
      expect(errors).toEqual([]);
      await context.close();
    });
  }

  test("the legend's default corner and state follow the layout; the author's settings win (0.8.1 review)", async ({
    browser,
    baseURL,
  }) => {
    const state = async (options: object, doc: string, edit?: (y: string) => string) => {
      const context = await browser.newContext({ ...options, reducedMotion: "reduce" });
      const page = await context.newPage();
      await guard(page, baseURL!);
      await openLayout(page, doc, edit);
      const s = await legendState(page);
      await context.close();
      return `${s.corner} ${s.open ? "open" : "collapsed"}`;
    };
    // Cards all on the left: a wide screen puts the legend top-right, open.
    expect(await state(DESK, "legend-left")).toBe("top-right open");
    // Cards on both sides (and full-width): collapsed, so it never sits on a card.
    expect(await state(DESK, "chrome", (y) => y.replace("  position: bottom-left\n", ""))).toBe("top-left collapsed");
    // The author's position and collapsed win.
    expect(await state(DESK, "chrome")).toBe("bottom-left collapsed");
    expect(await state(PHONE, "legend", (y) => y.replace("  title: Places\n", "  title: Places\n  collapsed: false\n"))).toBe(
      "top-left open"
    );
    expect(await state(DESK, "legend", (y) => y.replace("  title: Places\n", "  title: Places\n  collapsed: true\n"))).toBe(
      "top-left collapsed"
    );
    expect(
      await state(DESK, "legend", (y) => y.replace("  title: Places\n", "  title: Places\n  position: bottom-right\n"))
    ).toBe("bottom-right open");
  });

  test("the legend button: Enter and Space open it, Escape closes it and returns focus; a tap outside closes it on a phone (0.8.1 review)", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ ...PHONE, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = await guard(page, baseURL!);
    await openLayout(page, "legend");
    await scrollToChapter(page, "first");
    const toggle = page.locator(".scrolly-legend-toggle");
    const panel = page.locator(".scrolly-legend-panel");
    // A real button that names the panel it controls.
    expect(await toggle.evaluate((b) => b.tagName)).toBe("BUTTON");
    const s0 = await legendState(page);
    expect(s0.controls).toBe(s0.panelId);
    expect(s0.expanded).toBe("false");
    await expect(panel).toBeHidden();

    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
    expect((await legendState(page)).expanded).toBe("true");
    await expect(panel).toContainText("Volcano");
    // The open panel is above the card that is passing under it.
    await page.evaluate(() => {
      const card = document.querySelector('.scrolly-chapter[data-chapter-id="first"] .chapter-content')!;
      scrollBy(0, card.getBoundingClientRect().top - 20);
    });
    await settle(page);
    const over = await legendState(page);
    expect(over.panelOnTop, "elementFromPoint at the panel's centre is the panel").toBe(true);
    // Not modal: focus can leave it (Tab moves on), and Escape closes it.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    expect(await page.evaluate(() => document.activeElement?.className)).toContain("scrolly-legend-toggle");

    await page.keyboard.press("Space");
    await expect(panel).toBeVisible();
    // A tap on the map, outside the legend, closes it.
    await page.touchscreen.tap(200, 500);
    await expect(panel).toBeHidden();
    expect(errors).toEqual([]);
    await context.close();
  });

  test("on a wide screen an open-by-default legend stays open on outside clicks; Escape inside it closes it (0.8.1 review)", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ ...DESK, reducedMotion: "reduce" });
    const page = await context.newPage();
    await guard(page, baseURL!);
    await openLayout(page, "legend");
    const panel = page.locator(".scrolly-legend-panel");
    await expect(panel).toBeVisible();
    await page.mouse.click(700, 400);
    await page.keyboard.press("Escape");
    await expect(panel, "an outside click or a stray Escape leaves it open").toBeVisible();
    await page.locator(".scrolly-legend-toggle").focus();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await page.locator(".scrolly-legend-toggle").click();
    await expect(panel).toBeVisible();
    await context.close();
  });

  test("the legend panel animates only without reduced motion (0.8.1 review)", async ({ browser, baseURL }) => {
    for (const [reducedMotion, expected] of [
      ["reduce", "none"],
      ["no-preference", "ml-scrolly-legend-in"],
    ] as const) {
      const context = await browser.newContext({ ...DESK, reducedMotion });
      const page = await context.newPage();
      await guard(page, baseURL!);
      await openLayout(page, "legend");
      expect((await legendState(page)).animation, reducedMotion).toBe(expected);
      await context.close();
    }
  });

  // The rail's dots: neutral two-tone by default, visible on any basemap.
  const railState = (page: Page) =>
    page.evaluate(() => {
      const dots = [...document.querySelectorAll<HTMLElement>(".chapter-marker")];
      const style = (el: HTMLElement) => {
        const s = getComputedStyle(el, "::before");
        return { fill: s.backgroundColor, outline: s.borderTopColor, width: parseFloat(s.width) };
      };
      return {
        active: style(dots.find((d) => d.classList.contains("active"))!),
        inactive: style(dots.find((d) => !d.classList.contains("active"))!),
      };
    });

  /** WCAG contrast ratio of two `rgb(...)` colors. */
  function contrast(a: string, b: string): number {
    const lum = (c: string) => {
      const [r, g, bl] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
        const x = Number(v) / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  }

  test("the rail's dots are two-tone, stand out on light and dark maps, and the current one differs by more than colour (0.8.1 review)", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ ...DESK, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = await guard(page, baseURL!);
    await openLayout(page, "legend");
    const s = await railState(page);
    expect(s.inactive.fill).toBe("rgb(255, 255, 255)");
    expect(s.inactive.outline).toBe("rgb(31, 41, 55)");
    expect(s.active.fill).toBe("rgb(31, 41, 55)");
    // Bigger, not just another colour (WCAG 1.4.1).
    expect(s.active.width).toBeGreaterThan(s.inactive.width + 4);
    // At least 3:1 against the map behind it (WCAG 1.4.11): one of the dot's
    // two tones always is, on light, dark, water, park and brand-teal maps.
    for (const background of ["rgb(255, 255, 255)", "rgb(0, 0, 0)", "rgb(170, 211, 223)", "rgb(200, 230, 201)", "rgb(63, 177, 206)", "rgb(31, 41, 55)", "rgb(128, 128, 128)"]) {
      for (const dot of [s.inactive, s.active]) {
        const best = Math.max(contrast(dot.fill, background), contrast(dot.outline, background));
        expect(best, `dot ${dot.fill}/${dot.outline} on ${background}`).toBeGreaterThanOrEqual(3);
      }
    }
    // Screenshots on a light and a dark map.
    for (const [name, color] of [
      ["light", "#f2efe9"],
      ["dark", "#1b1f24"],
    ]) {
      await page.evaluate((c) => (document.querySelector("ml-scrollytelling") as any).getMap().setPaintProperty("background", "background-color", c), color);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `e2e/results/story-rail-${name}.png`, clip: { x: 1180, y: 300, width: 100, height: 200 } });
    }
    expect(errors).toEqual([]);
    await context.close();
  });

  test("markerColor still fills the dots, keeping the dark outline (0.8.1 review)", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ ...DESK, reducedMotion: "reduce" });
    const page = await context.newPage();
    await guard(page, baseURL!);
    await openLayout(page, "legend", (y) => y.replace("showMarkers: true\n", 'showMarkers: true\nmarkerColor: "#e63946"\n'));
    const s = await railState(page);
    expect(s.inactive.fill).toBe("rgb(230, 57, 70)");
    expect(s.active.fill).toBe("rgb(230, 57, 70)");
    expect(s.inactive.outline).toBe("rgb(31, 41, 55)");
    expect(s.active.width).toBeGreaterThan(s.inactive.width + 4);
    await context.close();
  });

  test("phone on its side: every chapter's subject is beside its card, not under it (ml-aot.50)", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 844, height: 390 },
      reducedMotion: "reduce",
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = await guard(page, baseURL!);
    await page.goto("/examples/verification/story-layout/index.html?doc=chrome", { waitUntil: "domcontentloaded" });
    await storyReady(page, "pts");
    const covered: string[] = [];
    for (const [id, at] of [
      ["intro", [10, 40]],
      ["centred", [-20, 10]],
      ["full", [60, -10]],
      ["right", [10, 40]],
    ] as const) {
      await scrollToChapter(page, id);
      await settled(page);
      const s = await page.evaluate(
        ([chapterId, lngLat]) => {
          const el = document.querySelector("ml-scrollytelling") as any;
          const card = el.querySelector(`.scrolly-chapter[data-chapter-id="${chapterId}"] .chapter-content`).getBoundingClientRect();
          const box = el.querySelector(".scrolly-map-container").getBoundingClientRect();
          const p = el.getMap().project(lngLat);
          const x = box.left + p.x;
          const y = box.top + p.y;
          return { x, y, under: x > card.left && x < card.right && y > card.top && y < card.bottom, cardHeight: card.height };
        },
        [id, at] as const
      );
      if (s.under) covered.push(`${id}: subject (${Math.round(s.x)}, ${Math.round(s.y)}) under its card`);
      expect(s.cardHeight, `${id}: card fits the short screen`).toBeLessThan(390);
    }
    expect(covered, covered.join("\n")).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("opt-outs: cameraOffset: false, and a chapter's own padding (review N4)", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = await guard(page, baseURL!);
    await page.goto("/examples/verification/story-layout/index.html?doc=optouts", { waitUntil: "domcontentloaded" });
    await storyReady(page, "pts");
    const at = (id: string) =>
      page.evaluate((chapterId) => {
        const el = document.querySelector("ml-scrollytelling") as any;
        const map = el.getMap();
        const chapter = el.story.chapters.find((c: any) => c.id === chapterId);
        const box = el.querySelector(".scrolly-map-container").getBoundingClientRect();
        const p = map.project(chapter.center);
        return { x: p.x / box.width, y: p.y / box.height, padding: map.getPadding() };
      }, id);
    // cameraOffset: false -- a left card's chapter is at the map's centre.
    await scrollToChapter(page, "intro");
    await settled(page);
    const intro = await at("intro");
    expect(intro.x).toBeCloseTo(0.5, 1);
    expect(intro.y).toBeCloseTo(0.5, 1);
    // A chapter's own padding is used as written.
    await scrollToChapter(page, "right");
    await settled(page);
    const right = await at("right");
    expect(right.padding).toEqual({ top: 0, right: 0, bottom: 0, left: 300 });
    expect(errors).toEqual([]);
    await context.close();
  });

  test("a short desktop window (mouse) keeps a centred card centred; only touch screens get the side cards (review N2)", async ({
    browser,
    baseURL,
  }) => {
    const centreOf = async (opts: Parameters<typeof browser.newContext>[0]) => {
      const context = await browser.newContext({ reducedMotion: "reduce", ...opts });
      const page = await context.newPage();
      await guard(page, baseURL!);
      await page.goto("/examples/verification/story-layout/index.html?doc=chrome", { waitUntil: "domcontentloaded" });
      await storyReady(page, "pts");
      await scrollToChapter(page, "centred");
      const x = await page.evaluate(() => {
        const r = document.querySelector('.scrolly-chapter[data-chapter-id="centred"] .chapter-content')!.getBoundingClientRect();
        return (r.left + r.right) / 2 / innerWidth;
      });
      await context.close();
      return x;
    };
    // A browser window 900x450 with a mouse: the author's centred card.
    expect(await centreOf({ viewport: { width: 900, height: 450 } })).toBeCloseTo(0.5, 1);
    // A phone on its side: the narrow card on the left.
    expect(await centreOf({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })).toBeLessThan(0.4);
  });

  test("a full-width card's photo never fills the map, and its subject shows (ml-aot.50)", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = await guard(page, baseURL!);
    await page.goto("/examples/verification/story-layout/index.html?doc=chrome", { waitUntil: "domcontentloaded" });
    await storyReady(page, "pts");
    await scrollToChapter(page, "full");
    await settled(page);
    const s = await page.evaluate(() => {
      const el = document.querySelector("ml-scrollytelling") as any;
      const card = el.querySelector('.scrolly-chapter[data-chapter-id="full"] .chapter-content').getBoundingClientRect();
      const img = el.querySelector('.scrolly-chapter[data-chapter-id="full"] .chapter-media img').getBoundingClientRect();
      const box = el.querySelector(".scrolly-map-container").getBoundingClientRect();
      const p = el.getMap().project([60, -10]);
      return { cardHeight: card.height, imgHeight: img.height, cardTop: card.top, subjectY: box.top + p.y };
    });
    expect(s.imgHeight).toBeLessThanOrEqual(800 * 0.4 + 1);
    expect(s.cardHeight).toBeLessThan(800 * 0.8);
    expect(s.subjectY, "subject above the full-width card").toBeLessThan(s.cardTop);
    expect(s.subjectY).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    await context.close();
  });

  for (const key of ["PageDown", "Space"] as const) {
    test(`reading with ${key}: every chapter in turn, each card wholly on screen (ml-aot.67)`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      const errors = await guard(page, baseURL!);
      await page.goto(EXAMPLE, { waitUntil: "domcontentloaded" });
      await storyReady(page);
      await page.evaluate(() => scrollTo(0, 0));
      await page.mouse.click(5, 5);
      const ids = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".scrolly-chapter")].map((s) => s.dataset.chapterId!)
      );
      const seen: string[] = [];
      const whole = new Set<string>();
      for (let i = 0; i < ids.length + 3; i++) {
        await page.keyboard.press(key);
        await page.waitForTimeout(400);
        const s = await page.evaluate(() => {
          const el = document.querySelector("ml-scrollytelling") as HTMLElement;
          const id = el.dataset.activeChapter ?? null;
          const card = id
            ? el.querySelector(`.scrolly-chapter[data-chapter-id="${id}"] .chapter-content`)!.getBoundingClientRect()
            : null;
          return { id, whole: !!card && card.top >= 0 && card.bottom <= innerHeight, y: scrollY, max: document.documentElement.scrollHeight - innerHeight };
        });
        if (s.id && seen[seen.length - 1] !== s.id) seen.push(s.id);
        if (s.id && s.whole) whole.add(s.id);
      }
      expect(seen, "every chapter, in order").toEqual(ids);
      expect([...whole].sort(), "each card wholly on screen at its stop").toEqual([...ids].sort());
      // Past the last chapter the key scrolls the page on as usual.
      const end = await page.evaluate(() => ({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight }));
      expect(end.y).toBeGreaterThan(end.max - 900);
      expect(errors).toEqual([]);
      await context.close();
    });
  }

  // Review: once a card taller than the screen was at the top, each press
  // aimed at that same top again -- preventDefault() and a scroll of 0, so
  // the page stuck on it for good.
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1280, height: 800 },
  ]) {
    for (const [key, dir] of [
      ["PageDown", 1],
      ["PageUp", -1],
    ] as const) {
      test(`${key} through chapters taller than the screen at ${viewport.width}x${viewport.height}: never stalls, every chapter in order (review)`, async ({
        browser,
        baseURL,
      }) => {
        const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
        const page = await context.newPage();
        const errors = await guard(page, baseURL!);
        await page.goto("/examples/verification/story-layout/index.html?doc=tall", { waitUntil: "domcontentloaded" });
        await storyReady(page, "pts");
        const ids = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>(".scrolly-chapter")].map((s) => s.dataset.chapterId!)
        );
        const tallest = await page.evaluate(() =>
          Math.max(...[...document.querySelectorAll(".chapter-content")].map((c) => c.getBoundingClientRect().height))
        );
        expect(tallest, "the fixture has a card taller than the screen").toBeGreaterThan(viewport.height * 1.5);
        await page.evaluate((d) => scrollTo(0, d > 0 ? 0 : document.documentElement.scrollHeight), dir);
        await page.mouse.click(5, 5);
        const state = () =>
          page.evaluate(() => ({
            y: scrollY,
            max: document.documentElement.scrollHeight - innerHeight,
            id: (document.querySelector("ml-scrollytelling") as HTMLElement).dataset.activeChapter ?? null,
          }));
        // Each card's extent on the page, to check no text was skipped.
        const cards = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>(".scrolly-chapter")].map((s) => {
            const r = (s.querySelector(".chapter-content") ?? s).getBoundingClientRect();
            return { id: s.dataset.chapterId!, top: r.top + scrollY, bottom: r.bottom + scrollY };
          })
        );
        const seen: string[] = [];
        const problems: string[] = [];
        const windows: Array<[number, number]> = [];
        let last = await state();
        windows.push([last.y, last.y + viewport.height]);
        if (last.id && (dir > 0 ? last.id === ids[0] : last.id === ids[ids.length - 1])) seen.push(last.id);
        for (let i = 0; i < 80; i++) {
          await page.keyboard.press(key);
          await page.waitForTimeout(150);
          const s = await state();
          if (s.id && seen[seen.length - 1] !== s.id) seen.push(s.id);
          if ((s.y - last.y) * dir <= 0) problems.push(`press ${i + 1}: stuck at ${s.y} (${s.id})`);
          windows.push([s.y, s.y + viewport.height]);
          last = s;
          if (dir > 0 ? s.y >= s.max - 1 : s.y <= 1) break;
        }
        // Every line of every card was on screen at one of the stops: the
        // screens seen, merged, cover each card from top to bottom.
        const merged: Array<[number, number]> = [];
        for (const [a, b] of [...windows].sort((p, q) => p[0] - q[0])) {
          const tail = merged[merged.length - 1];
          if (tail && a <= tail[1]) tail[1] = Math.max(tail[1], b);
          else merged.push([a, b]);
        }
        for (const card of cards) {
          if (!merged.some(([a, b]) => a <= card.top + 1 && b >= card.bottom - 1)) {
            problems.push(`${card.id}: part of the card was never on screen`);
          }
        }
        expect(problems, problems.join("\n")).toEqual([]);
        expect(dir > 0 ? last.y : -last.y, "reached the end of the page").toBeGreaterThanOrEqual(dir > 0 ? last.max - 1 : -1);
        expect(seen, "every chapter, in order").toEqual(dir > 0 ? ids : [...ids].reverse());
        expect(errors).toEqual([]);
        await context.close();
      });
    }
  }

  test("quick PageDown presses step one chapter each, even mid-scroll (ml-aot.68)", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = await guard(page, baseURL!);
    await page.goto(EXAMPLE, { waitUntil: "domcontentloaded" });
    await storyReady(page);
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".scrolly-chapter")].map((s) => s.dataset.chapterId!)
    );
    expect(ids.length).toBeGreaterThanOrEqual(4);
    await scrollToChapter(page, ids[0]!);
    await page.mouse.click(5, 5);
    // Three presses before the first smooth scroll has gone anywhere.
    await page.keyboard.press("PageDown");
    await page.keyboard.press("PageDown");
    await page.keyboard.press("PageDown");
    await expect.poll(() => active(page), { message: "three presses, three chapters on" }).toBe(ids[3]);
    await page.waitForTimeout(1200);
    const off = await page.evaluate((id) => {
      const c = document.querySelector(`.scrolly-chapter[data-chapter-id="${id}"] .chapter-content`)!.getBoundingClientRect();
      return Math.abs(c.top + c.height / 2 - innerHeight / 2);
    }, ids[3]!);
    expect(off, "the third chapter's card is centred").toBeLessThan(8);
    expect(errors).toEqual([]);
    await context.close();
  });

  test("PageDown in a text field is left alone (ml-aot.67)", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    await guard(page, baseURL!);
    await page.goto(EXAMPLE, { waitUntil: "domcontentloaded" });
    await storyReady(page);
    const handled = await page.evaluate(() => {
      const input = document.createElement("input");
      document.body.prepend(input);
      input.focus();
      const e = new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true });
      input.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(handled).toBe(false);
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

  // Review blocker on 0.8.1: every resize re-framed an ambient chapter by
  // starting ANOTHER rotation loop beside the running one. Each loop's camera
  // call ended the others' moves, so the loops woke each other, and after
  // ~10 resize steps (a desktop drag) or ~8 rotations the tab froze.
  for (const [label, viewport, mobile, steps] of [
    ["a desktop window dragged narrower 24 times", { width: 1280, height: 800 }, false, 24],
    ["a phone rotated 12 times", { width: 390, height: 844 }, true, 12],
  ] as const) {
    test(`ambient chapters survive ${label}: one loop, still turning, page responsive (review blocker)`, async ({
      browser,
      baseURL,
    }) => {
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
      const page = await context.newPage();
      const errors = await guard(page, baseURL!);
      await page.goto("/examples/verification/story-layout/index.html?doc=ambient", { waitUntil: "domcontentloaded" });
      await storyReady(page, "pts");
      const within = <T>(p: Promise<T>, ms: number) =>
        Promise.race([p, new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), ms))]);
      const probe = () =>
        within(
          onMap<{ bearing: number; lng: number; listeners: number }>(
            page,
            `({ bearing: map.getBearing(), lng: map.getCenter().lng,
                listeners: (map._listeners?.moveend?.length ?? 0) + (map._oneTimeListeners?.moveend?.length ?? 0) })`
          ),
          3000
        );
      for (const [id, moving] of [
        ["turning", "bearing"],
        ["spinning", "lng"],
      ] as const) {
        await scrollToChapter(page, id);
        // Past the chapter's flight, into the ambient loop.
        await page.waitForTimeout(3500);
        const before = await probe();
        expect(before, `${id}: page answers before resizing`).not.toBe("TIMEOUT");
        for (let i = 0; i < steps; i++) {
          const size = mobile
            ? i % 2 === 0
              ? { width: viewport.height, height: viewport.width }
              : viewport
            : { width: viewport.width - i * 15, height: viewport.height };
          const done = await within(page.setViewportSize(size).then(() => "ok"), 5000);
          expect(done, `${id}: resize ${i + 1} of ${steps} returns`).toBe("ok");
          await page.waitForTimeout(mobile ? 300 : 60);
        }
        await page.setViewportSize(viewport);
        await page.waitForTimeout(1500);
        const after = await probe();
        expect(after, `${id}: page answers after ${steps} resizes`).not.toBe("TIMEOUT");
        if (before === "TIMEOUT" || after === "TIMEOUT") return;
        expect(after.listeners, `${id}: moveend listeners ${before.listeners} -> ${after.listeners}`).toBe(
          before.listeners
        );
        expect(await active(page)).toBe(id);
        // Still turning (spinning) a second later.
        await page.waitForTimeout(1000);
        const later = await probe();
        expect(later).not.toBe("TIMEOUT");
        if (later !== "TIMEOUT") {
          expect(Math.abs(later[moving] - after[moving]), `${id}: ${moving} still changing`).toBeGreaterThan(0.5);
        }
      }
      expect(errors, errors.join("\n")).toEqual([]);
      await context.close();
    });
  }

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
    // The message names the chapter, so the 0-based path is not repeated (ml-aot.62).
    await expect(card).toContainText(/Chapter 2 \(/);
    await expect(card).not.toContainText("chapters.1.");
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
    "https://unpkg.com/@maplibre-yaml/core@0.9/register.js": `${baseURL}/packages/core/register.js`,
    "https://unpkg.com/@maplibre-yaml/core@0.9/dist/register.browser.js": `${baseURL}/packages/core/dist/register.browser.js`,
    "https://demotiles.maplibre.org/style.json": `${baseURL}${LOCAL_STYLE}`,
    "https://tiles.openfreemap.org/styles/liberty": `${baseURL}${LOCAL_STYLE}`,
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

  /** The active chapter, and how far the map's centre is from its `center` (degrees). */
  const cameraVsActive = (page: Page) =>
    page.evaluate(() => {
      const el = document.querySelector("ml-scrollytelling") as any;
      const id = el.dataset.activeChapter;
      const chapter = el.story.chapters.find((c: any) => c.id === id);
      const map = el.getMap();
      const c = map.getCenter();
      const [lng, lat] = chapter.center;
      // The camera's padding, and what the layout on screen now asks for
      // (ml-aot.69): a rotation must re-frame for the new layout.
      const padding = map.getPadding();
      const want = el.cameraPadding(chapter);
      const padOff = Math.max(...(["top", "right", "bottom", "left"] as const).map((k) => Math.abs(padding[k] - want[k])));
      // Where the chapter's centre lands, against the middle of the part of
      // the map the card leaves free.
      const p = map.project(chapter.center);
      const canvas = map.getCanvas().getBoundingClientRect();
      const freeX = padding.left + (canvas.width - padding.left - padding.right) / 2;
      const freeY = padding.top + (canvas.height - padding.top - padding.bottom) / 2;
      return {
        id,
        off: Math.max(Math.abs(c.lng - lng), Math.abs(c.lat - lat)),
        zoom: map.getZoom(),
        padding,
        padOff,
        framed: Math.max(Math.abs(p.x - freeX), Math.abs(p.y - freeY)),
      };
    });

  /** Rotate the phone: resize the viewport, then wait for the camera to settle. */
  async function rotate(page: Page, width: number, height: number) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(400);
    await settled(page);
    await page.waitForTimeout(300);
  }

  test("rotating a phone mid-story keeps the reader's chapter and its camera (ml-aot.58, ml-aot.59)", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const [html] = fences(PAGE, "html");
    const [yaml] = fences(PAGE, "yaml");
    const errors = await serveDocs(page, baseURL!, { "index.html": html, "story.yaml": yaml });
    await page.goto("/__docs/story/", { waitUntil: "domcontentloaded" });
    await storyReady(page, "cities");
    const log: string[] = [];
    for (const id of ["jakarta", "lima"]) {
      await scrollToChapter(page, id);
      await settled(page);
      for (const [w, h] of [
        [844, 390],
        [390, 844],
        [844, 390],
        [390, 844],
      ] as const) {
        await rotate(page, w, h);
        const s = await cameraVsActive(page);
        // The same chapter (ml-aot.59), and the camera on it (ml-aot.58).
        if (s.id !== id) log.push(`reading ${id}, after ${w}x${h}: ${s.id} active`);
        if (s.off > 0.05) log.push(`reading ${id}, after ${w}x${h}: camera ${s.off.toFixed(2)}° off ${s.id}`);
        // Framed for the NEW layout (ml-aot.69): the padding the cards on
        // screen now ask for, and the centre in the middle of the free part.
        const where = `reading ${id}, after ${w}x${h}`;
        if (s.padOff > 2) log.push(`${where}: padding ${JSON.stringify(s.padding)} is the old layout's`);
        if (s.framed > 3) log.push(`${where}: chapter centre ${s.framed.toFixed(0)}px from the free area's middle`);
        // On its side the cards sit beside the map; upright, below it.
        const landscape = w > h;
        const side = id === "jakarta" ? s.padding.right : s.padding.left;
        if (landscape && (s.padding.bottom > 0 || side < 150)) log.push(`${where}: landscape padding ${JSON.stringify(s.padding)}`);
        if (!landscape && (s.padding.bottom < 100 || s.padding.left > 0 || s.padding.right > 0)) {
          log.push(`${where}: portrait padding ${JSON.stringify(s.padding)}`);
        }
      }
    }
    expect(log, log.join("\n")).toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
    await context.close();
  });

  test("after a rotation that changes the active chapter, the camera follows (ml-aot.58)", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const [html] = fences(PAGE, "html");
    const [yaml] = fences(PAGE, "yaml");
    const errors = await serveDocs(page, baseURL!, { "index.html": html, "story.yaml": yaml });
    await page.goto("/__docs/story/", { waitUntil: "domcontentloaded" });
    await storyReady(page, "cities");
    await scrollToChapter(page, "jakarta");
    await settled(page);
    // Resize so the page's own scroll offset now shows another chapter, the
    // way 0.8.1's first rotation fix candidates could: the camera must land
    // on whichever chapter is active afterwards.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => {
      const s = document.querySelector<HTMLElement>('.scrolly-chapter[data-chapter-id="lima"]')!;
      const c = (s.querySelector(".chapter-content") ?? s).getBoundingClientRect();
      scrollBy(0, c.top + c.height / 2 - innerHeight / 2);
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await settled(page);
    const s = await cameraVsActive(page);
    expect(s.off, `camera ${s.off.toFixed(2)}° off active chapter ${s.id}`).toBeLessThan(0.05);
    // ...framed for the upright layout, not the one on its side (ml-aot.69).
    expect(s.padOff, `padding ${JSON.stringify(s.padding)} is not the upright layout's`).toBeLessThan(3);
    expect(s.padding.bottom).toBeGreaterThan(100);
    expect(s.framed, "chapter centre in the middle of the free area").toBeLessThan(4);
    expect(errors, errors.join("\n")).toEqual([]);
    await context.close();
  });

  test("the quick start (index.html + story.yaml) is a working story", async ({ page, baseURL }) => {
    const [html] = fences(PAGE, "html");
    const inlineHtml = fences(PAGE, "html").find((h) => h.includes('<script type="text/yaml">'))!;
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

  /** Where a chapter's center lands on screen, and its card's box. */
  const subjectAndCard = (page: Page, chapterId: string, lngLat: [number, number]) =>
    page.evaluate(
      ([id, at]) => {
        const el = document.querySelector("ml-scrollytelling") as any;
        const p = el.getMap().project(at);
        const box = el.querySelector(".scrolly-map-container").getBoundingClientRect();
        const card = el.querySelector(`.scrolly-chapter[data-chapter-id="${id}"] .chapter-content`).getBoundingClientRect();
        return {
          subject: { x: box.left + p.x, y: box.top + p.y },
          card: { left: card.left, right: card.right, top: card.top, bottom: card.bottom },
        };
      },
      [chapterId, lngLat] as const
    );

  test("desktop: a centre-aligned chapter's subject is not under its card (ml-aot.39)", async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const [html] = fences(PAGE, "html");
    const [yaml] = fences(PAGE, "yaml");
    const errors = await serveDocs(page, baseURL!, { "index.html": html, "story.yaml": yaml });
    await page.goto("/__docs/story/", { waitUntil: "domcontentloaded" });
    await storyReady(page, "cities");
    await scrollToChapter(page, "lagos");
    await settled(page);
    // Still the chapter's camera (getCenter() is the padded centre)...
    await expectCameraNear(page, [3.38, 6.52], 5);
    // ...but drawn above the card, where the reader can see it.
    const { subject, card } = await subjectAndCard(page, "lagos", [3.38, 6.52]);
    const under = subject.x > card.left && subject.x < card.right && subject.y > card.top && subject.y < card.bottom;
    expect(under, `Lagos at ${JSON.stringify(subject)} vs card ${JSON.stringify(card)}`).toBe(false);
    expect(subject.y).toBeGreaterThan(0);
    expect(subject.y).toBeLessThan(card.top);
    await page.screenshot({ path: "e2e/results/story-center-card-desk.png" });
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("phone: a bottom-left legend sits above the chapter card, not under it (ml-aot.39)", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    // A slow CPU, as on CI: the card's activation transition then ends well
    // after the last scroll event, which is when a stale legend placement
    // showed (it failed on CI only before the chrome re-placed on
    // transitionend).
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    const [html] = fences(PAGE, "html");
    const [yaml] = fences(PAGE, "yaml");
    // A legend with a few entries and chapter text long enough to fill the
    // card's width, as in a student's story (ml-aot.39's screenshot).
    const long =
      "<p>The largest city in Africa, on the Gulf of Guinea. Its lagoons, islands and " +
      "bridges hold more than fifteen million people.</p>";
    const withLegend = yaml
      .replace("layers:\n", "legend:\n  position: bottom-left\n  title: Cities\n  items:\n    - { label: Megacity, color: \"#f97316\" }\n    - { label: Port, color: \"#22c55e\" }\n    - { label: Capital, color: \"#3b82f6\" }\nlayers:\n")
      .replace('"<p>The largest city in Africa.</p>"', JSON.stringify(long))
      .replace('"<p>On the Pacific coast of South America.</p>"', JSON.stringify(long));
    expect(withLegend).toContain("position: bottom-left");
    expect(withLegend).toContain("fifteen million");
    const errors = await serveDocs(page, baseURL!, { "index.html": html, "story.yaml": withLegend });
    await page.goto("/__docs/story/", { waitUntil: "domcontentloaded" });
    await storyReady(page, "cities");
    for (const id of ["lagos", "lima"]) {
      await scrollToChapter(page, id);
      // Where a reader stops: the chapter filling the screen, its card resting
      // low (the layout the camera offset is computed for).
      await page.evaluate((chapterId) => {
        const s = document.querySelector(`.scrolly-chapter[data-chapter-id="${chapterId}"]`)!;
        scrollBy(0, s.getBoundingClientRect().top);
      }, id);
      await expect.poll(() => active(page)).toBe(id);
      await settled(page);
      // The card finishes its activation transition (0.3s) after the scroll.
      await page.waitForTimeout(400);
      const hit = await page.evaluate((chapterId) => {
        // On a phone the legend is a pinned button above the cards (0.8.1).
        const legend = document.querySelector<HTMLElement>(".scrolly-legend-toggle")!;
        const card = document
          .querySelector(`.scrolly-chapter[data-chapter-id="${chapterId}"] .chapter-content`)!
          .getBoundingClientRect();
        const r = legend.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
        const overlap =
          r.left < card.right && card.left < r.right && r.top < card.bottom && card.top < r.bottom;
        return {
          onTop: !!top && legend.contains(top),
          overlap,
          legend: [r.left, r.top, r.right, r.bottom].map(Math.round),
          card: [card.left, card.top, card.right, card.bottom].map(Math.round),
          top: top?.className ?? null,
        };
      }, id);
      expect(hit.overlap, `${id}: legend ${hit.legend} overlaps card ${hit.card}`).toBe(false);
      expect(hit.onTop, `${id}: legend title covered by ${hit.top}`).toBe(true);
    }
    await page.screenshot({ path: "e2e/results/story-legend-mob.png" });
    expect(errors, errors.join("\n")).toEqual([]);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
// The map notice beside the story's pinned legend on a phone (ml-aot.108):
// readers see a failure notice ("Part of this map couldn't load"), so it must
// stay readable with the legend closed or open.
// ---------------------------------------------------------------------------
for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`a phone story's legend never covers the map notice: ${viewport.width}x${viewport.height} (ml-aot.108)`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/examples/verification/story-layout/index.html?doc=notice", { waitUntil: "domcontentloaded" });
    await storyReady(page, "grid");
    const notice = page.locator("ml-scrollytelling .ml-map-notice");
    await expect(notice).toContainText("Part of this map couldn't load", { timeout: 30_000 });
    await page.waitForSelector(".scrolly-legend");

    const overlap = () =>
      page.evaluate(() => {
        const root = document.querySelector<HTMLElement>("ml-scrollytelling .scrolly-legend")!;
        const n = document.querySelector<HTMLElement>("ml-scrollytelling .ml-map-notice")!;
        const parts = [root.querySelector(".scrolly-legend-toggle")!, root.querySelector(".scrolly-legend-panel")!]
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.width > 0);
        const b = n.getBoundingClientRect();
        const hit = (a: DOMRect) =>
          a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        const heading = n.querySelector("strong")!.getBoundingClientRect();
        const atHeading = document.elementFromPoint(heading.left + 4, heading.top + heading.height / 2);
        return {
          overlaps: parts.some(hit),
          headingVisible: n.contains(atHeading),
          inMap: b.left >= 0 && b.right <= innerWidth,
        };
      });

    mkdirSync("e2e/screenshots", { recursive: true });
    const closed = await page.evaluate(() =>
      document.querySelector(".scrolly-legend-panel")!.hasAttribute("hidden")
    );
    for (const state of closed ? ["closed", "open"] : ["open", "closed"]) {
      if (state !== (closed ? "closed" : "open")) await page.locator(".scrolly-legend-toggle").click();
      await expect.poll(overlap).toEqual({ overlaps: false, headingVisible: true, inMap: true });
      await page.screenshot({ path: `e2e/screenshots/story-notice-${viewport.width}x${viewport.height}-${state}.png` });
    }
    await context.close();
  });
}
