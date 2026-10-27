/**
 * Live documents (ml-4ug, 0.10) — browser proof of the acceptance examples,
 * on the fixture that is also the demo (examples/verification/live-update.html).
 *
 * @remarks
 * One test per acceptance example AE1–AE11 of
 * docs/plans/2026-10-27-001-feat-live-documents-plan.md, plus the queue
 * (overlapping updates coalesce last-wins) and a basemap swap while the
 * map is being panned. Every assertion awaits the element's real DOM
 * events (`ml-map:update-applied`, `ml-map:update-rejected`,
 * `ml-map:state-change`, `ml-map:load`) and reads the summary from the
 * event detail; nothing polls a flag. Hermetic: the plain CDN build from
 * the e2e server's /cdn/ mount, a source-less local basemap, data files
 * next to the fixture; any off-origin request fails the test.
 *
 * Effects (a paint change keeps the effect attached; a reorder keeps the
 * `::fx-` layer above its static layer) live in e2e/effects.spec.ts with
 * the effects fixture; stories in e2e/scrollytelling.spec.ts.
 */
import { test, expect, type Page } from "@playwright/test";

const PAGE = "/examples/verification/live-update.html";
const DOC_LAYERS = ["areas", "routes", "towns", "grades"];

/** Page errors (an unhandled rejection is one), console errors and off-origin requests. */
async function guard(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(url) || /^(data|blob):/.test(url)) return route.fallback();
    errors.push(`external request (suite must stay hermetic): ${url}`);
    return route.abort();
  });
  return errors;
}

/** Open the fixture and wait until the map is loaded and the towns have drawn. */
async function open(page: Page, query = ""): Promise<string[]> {
  const errors = await guard(page);
  await page.goto(`${PAGE}${query}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => (document.getElementById("map") as any).mapReady());
  await page.waitForFunction(
    () => {
      const map = (document.getElementById("map") as any).getMap();
      return map.isStyleLoaded() && map.queryRenderedFeatures(undefined, { layers: ["towns"] }).length > 0;
    },
    undefined,
    { timeout: 45_000 }
  );
  await settle(page);
  return errors;
}

/** Wait for a settled frame (sources loaded, nothing moving). */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const map = (document.getElementById("map") as any).getMap();
        map.once("idle", () => resolve());
        map.triggerRepaint();
      })
  );
}

/** What the element answered a document with: the next `ml-map:update-*` event, as the page saw it. */
interface UpdateOutcome {
  type: "ml-map:update-applied" | "ml-map:update-rejected";
  detail: {
    kind?: string;
    errors?: { kind: string; message: string; path?: string }[];
    summary?: {
      added: string[];
      removed: string[];
      moved: string[];
      replaced: string[];
      propertiesSet: { layerId: string; property: string }[];
      sourcesReplaced: string[];
      cameraMoved: boolean;
      rebuild: boolean;
      failures: { op: string; message: string }[];
    };
  };
}

/** Apply one of the fixture's canned documents and resolve with the real event. */
function apply(page: Page, doc: string, colour?: string): Promise<UpdateOutcome> {
  return page.evaluate(
    ([doc, colour]) => {
      const live = (window as any).__live;
      return live.apply(live.docs[doc](live.el.getDocument(), colour)) as Promise<UpdateOutcome>;
    },
    [doc, colour] as const
  );
}

const camera = (page: Page) =>
  page.evaluate(() => {
    const map = (document.getElementById("map") as any).getMap();
    const c = map.getCenter();
    return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  });

const jumpTo = (page: Page, center: [number, number], zoom: number) =>
  page.evaluate(([center, zoom]) => (document.getElementById("map") as any).getMap().jumpTo({ center, zoom }), [
    center,
    zoom,
  ] as const);

/** The document's layers in the order the live style holds them. */
const documentOrder = (page: Page) =>
  page.evaluate(
    (ids) => (document.getElementById("map") as any).getMap().getLayersOrder().filter((id: string) => ids.includes(id)),
    DOC_LAYERS
  );

/** Features the towns layer has drawn after a settled frame. */
async function townsDrawn(page: Page): Promise<number> {
  await settle(page);
  return page.evaluate(
    () => (document.getElementById("map") as any).getMap().queryRenderedFeatures(undefined, { layers: ["towns"] }).length
  );
}

/** Remember the current map object on the page, to tell a rebuild from an in-place update. */
const rememberMap = (page: Page) =>
  page.evaluate(() => {
    (window as any).__firstMap = (document.getElementById("map") as any).getMap();
  });
const sameMap = (page: Page) =>
  page.evaluate(() => (document.getElementById("map") as any).getMap() === (window as any).__firstMap);

const eventTypes = (page: Page) => page.evaluate(() => (window as any).__events.map((e: { type: string }) => e.type));

function expectCameraEqual(a: Awaited<ReturnType<typeof camera>>, b: Awaited<ReturnType<typeof camera>>) {
  expect(a.lng).toBeCloseTo(b.lng, 6);
  expect(a.lat).toBeCloseTo(b.lat, 6);
  expect(a.zoom).toBeCloseTo(b.zoom, 6);
  expect(a.bearing).toBeCloseTo(b.bearing, 6);
  expect(a.pitch).toBeCloseTo(b.pitch, 6);
}

test.describe("live documents: acceptance examples (ml-4ug)", () => {
  test("AE1: a reordered document moves the layers in place; the summary reports moves, no adds or removes", async ({
    page,
  }) => {
    const errors = await open(page);
    await rememberMap(page);
    // Every document layer is on the map, in document order: first render
    // adds layers concurrently (a named-source layer lands first) and then
    // runs the same ordering pass an update does (KTD3).
    expect(await documentOrder(page)).toEqual(DOC_LAYERS);

    const outcome = await apply(page, "reordered");
    expect(outcome.type).toBe("ml-map:update-applied");
    const summary = outcome.detail.summary!;
    expect(summary.moved.length).toBeGreaterThan(0);
    expect(summary.added).toEqual([]);
    expect(summary.removed).toEqual([]);
    expect(summary.replaced).toEqual([]);
    expect(summary.failures).toEqual([]);
    expect(summary.rebuild).toBe(false);
    expect(await documentOrder(page)).toEqual(["towns", "areas", "routes", "grades"]);
    expect(await sameMap(page)).toBe(true);
    expect(await page.evaluate(() => (document.getElementById("map") as any).getDocument().layers.map((l: any) => l.id))).toEqual([
      "towns",
      "areas",
      "routes",
      "grades",
    ]);

    // Back the other way: the full reverse of the document lands exactly in document order.
    const reversed = await page.evaluate(() => {
      const live = (window as any).__live;
      const next = live.clone(live.el.getDocument());
      next.layers.reverse();
      return live.apply(next) as Promise<UpdateOutcome>;
    });
    expect(reversed.type).toBe("ml-map:update-applied");
    expect(reversed.detail.summary!.moved.length).toBeGreaterThan(0);
    expect(reversed.detail.summary!.added).toEqual([]);
    expect(reversed.detail.summary!.removed).toEqual([]);
    expect(await documentOrder(page)).toEqual(["grades", "routes", "areas", "towns"]);
    await page.screenshot({ path: "e2e/results/live_update_reordered.png" });
    expect(errors).toEqual([]);
  });

  test("AE2: a changed url: on a GeoJSON source replaces its data; the layers stay and their popups keep working", async ({
    page,
  }) => {
    const errors = await open(page);
    await rememberMap(page);
    // querySourceFeatures answers per tile, so names are counted, not features.
    const editions = () =>
      page.evaluate(() => {
        const map = (document.getElementById("map") as any).getMap();
        const features = map.querySourceFeatures("towns");
        return {
          names: new Set(features.map((f: any) => f.properties.name)).size,
          editions: [...new Set(features.map((f: any) => f.properties.edition))],
        };
      });
    expect(await editions()).toEqual({ names: 5, editions: [2023] });
    const orderBefore = await documentOrder(page);

    const outcome = await apply(page, "edition2024");
    expect(outcome.type).toBe("ml-map:update-applied");
    expect(outcome.detail.summary!.removed).toEqual([]);
    expect(outcome.detail.summary!.added).toEqual([]);
    expect(outcome.detail.summary!.failures).toEqual([]);
    expect(await sameMap(page)).toBe(true);
    // The new file's features, under the same source and layer ids, the layers where they were.
    await expect.poll(async () => (await editions()).editions, { timeout: 20_000 }).toEqual([2024]);
    await expect.poll(async () => (await editions()).names).toBe(6);
    expect(await documentOrder(page)).toEqual(orderBefore);
    expect(await page.evaluate(() => (document.getElementById("map") as any).getDocument().sources.towns.url)).toBe(
      "./live-update/2024.geojson"
    );

    // The towns' popup still opens: click Cedar (founded 2010, visible under year 2010).
    await settle(page);
    const point = await page.evaluate(() => {
      const map = (document.getElementById("map") as any).getMap();
      const p = map.project([10.25, 42.12]);
      const rect = map.getCanvas().getBoundingClientRect();
      return { x: rect.left + p.x, y: rect.top + p.y };
    });
    await page.mouse.click(point.x, point.y);
    await expect(page.locator("#map .maplibregl-popup")).toContainText("Cedar");
    await expect(page.locator("#map .maplibregl-popup")).toContainText("2024");
    expect(errors).toEqual([]);
  });

  test("AE3: an invalid document is refused with the diagnostics; the map, camera and document are untouched; the hint is on the page (local) and off under quiet", async ({
    page,
  }) => {
    const errors = await open(page);
    await rememberMap(page);
    await jumpTo(page, [10.3, 42.3], 10.5);
    const before = await camera(page);
    const style = () =>
      page.evaluate(() => {
        const map = (document.getElementById("map") as any).getMap();
        return JSON.stringify(map.getStyle().layers.map((l: any) => [l.id, l.type, l.paint]));
      });
    const styleBefore = await style();
    const docBefore = await page.evaluate(() => JSON.stringify((document.getElementById("map") as any).getDocument()));

    const outcome = await apply(page, "invalid");
    expect(outcome.type).toBe("ml-map:update-rejected");
    expect(outcome.detail.kind).toBe("validation");
    expect(outcome.detail.errors!.length).toBeGreaterThan(0);
    expect(outcome.detail.errors![0].kind).toBe("validation");
    expect(JSON.stringify(outcome.detail.errors)).toMatch(/lien|type/);

    expect(await style()).toBe(styleBefore);
    expectCameraEqual(await camera(page), before);
    expect(await page.evaluate(() => JSON.stringify((document.getElementById("map") as any).getDocument()))).toBe(docBefore);
    expect(await sameMap(page)).toBe(true);
    await expect(page.locator("#map .ml-map-error")).toHaveCount(0);
    // A page served from this computer shows author hints (as `debug` does anywhere).
    await expect(page.locator("#map .ml-map-notice")).toContainText("The map kept its last document");
    expect(await eventTypes(page)).toEqual(["ml-map:load", "ml-map:update-rejected"]);

    // A later valid document applies and takes the hint down.
    const fixed = await apply(page, "recolour");
    expect(fixed.type).toBe("ml-map:update-applied");
    await expect(page.locator("#map .ml-map-notice")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("AE3 (quiet): the refusal still fires its event, with no hint on the page", async ({ page }) => {
    const errors = await open(page, "?quiet");
    const outcome = await apply(page, "invalid");
    expect(outcome.type).toBe("ml-map:update-rejected");
    expect(outcome.detail.kind).toBe("validation");
    await page.waitForTimeout(300);
    await expect(page.locator("#map .ml-map-notice")).toHaveCount(0);
    await expect(page.locator("#map .ml-map-error")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("AE4: a mapStyle change rebuilds at the reader's camera, reports a rebuild, and getMap() is a new map", async ({
    page,
  }) => {
    const errors = await open(page);
    await page.evaluate(() => {
      const el = document.getElementById("map") as any;
      (window as any).__firstMap = el.getMap();
      (window as any).__firstCanvas = el.getMap().getCanvas();
    });
    await jumpTo(page, [10.5, 42.4], 8.2);
    const panned = await camera(page);
    expect(await documentOrder(page)).toEqual(DOC_LAYERS);

    const outcome = await apply(page, "basemap");
    expect(outcome.type).toBe("ml-map:update-applied");
    expect(outcome.detail.summary!.rebuild).toBe(true);
    expect(outcome.detail.summary!.failures).toEqual([]);
    expect(await sameMap(page)).toBe(false);
    // The new map object holds the document's layers, in document order, on the new basemap.
    expect(await documentOrder(page)).toEqual(DOC_LAYERS);
    expect(
      await page.evaluate(() => (document.getElementById("map") as any).getMap().getPaintProperty("background", "background-color"))
    ).toBe("#dfe3ee");
    expectCameraEqual(await camera(page), panned);
    // The old map is gone: one canvas, and the old one is off the page.
    expect(await page.locator("#map canvas.maplibregl-canvas").count()).toBe(1);
    expect(await page.evaluate(() => (window as any).__firstCanvas.isConnected)).toBe(false);
    // ml-map:load fired again for the new map, after the applied event's cause.
    expect(await eventTypes(page)).toEqual(["ml-map:load", "ml-map:load", "ml-map:update-applied"]);
    // The towns draw on the new map.
    await expect.poll(() => townsDrawn(page), { timeout: 20_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: "e2e/results/live_update_rebuilt.png" });
    expect(errors).toEqual([]);
  });

  test("AE5: a layer the host added through getMap() survives an in-place update", async ({ page }) => {
    const errors = await open(page);
    await rememberMap(page);
    await page.evaluate(() => (window as any).__live.addHostLayer());
    const hostLayer = () =>
      page.evaluate(() => {
        const map = (document.getElementById("map") as any).getMap();
        return { present: Boolean(map.getLayer("host-highlight")), source: Boolean(map.getSource("host-highlight")) };
      });
    expect(await hostLayer()).toEqual({ present: true, source: true });

    const outcome = await apply(page, "reordered");
    expect(outcome.type).toBe("ml-map:update-applied");
    expect(outcome.detail.summary!.failures).toEqual([]);
    expect(outcome.detail.summary!.removed).toEqual([]);
    expect(await hostLayer()).toEqual({ present: true, source: true });
    expect(await documentOrder(page)).toEqual(["towns", "areas", "routes", "grades"]);
    expect(await sameMap(page)).toBe(true);
    // The host layer is invisible to the document: not in getDocument().
    expect(await page.evaluate(() => (document.getElementById("map") as any).getDocument().layers.some((l: any) => l.id === "host-highlight"))).toBe(false);
    expect(errors).toEqual([]);
  });

  test("AE6: the camera stays when the document's camera is unchanged, follows a changed center, and never moves under camera=\"host\"", async ({
    page,
  }) => {
    const errors = await open(page);
    await rememberMap(page);
    // Unchanged camera keys, reader panned away: a paint edit leaves the camera alone.
    await jumpTo(page, [10.4, 42.35], 10.2);
    const panned = await camera(page);
    const recoloured = await apply(page, "recolour");
    expect(recoloured.type).toBe("ml-map:update-applied");
    expect(recoloured.detail.summary!.cameraMoved).toBe(false);
    expect(recoloured.detail.summary!.propertiesSet).toEqual([{ layerId: "towns", property: "circle-color" }]);
    expectCameraEqual(await camera(page), panned);

    // A changed center: the camera moves to it.
    const recentred = await apply(page, "recentred");
    expect(recentred.type).toBe("ml-map:update-applied");
    expect(recentred.detail.summary!.cameraMoved).toBe(true);
    await expect
      .poll(async () => {
        const c = await camera(page);
        return Math.abs(c.lng - 10.6) < 1e-3 && Math.abs(c.lat - 42.5) < 1e-3;
      })
      .toBe(true);
    expect(await sameMap(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  test("AE6 (camera=\"host\"): a changed center never moves the camera, and a basemap rebuild keeps it too", async ({
    page,
  }) => {
    const errors = await open(page, "?camera=host");
    expect(await page.evaluate(() => (document.getElementById("map") as any).camera)).toBe("host");
    await jumpTo(page, [10.4, 42.35], 10.2);
    const panned = await camera(page);

    const recentred = await apply(page, "recentred");
    expect(recentred.type).toBe("ml-map:update-applied");
    expect(recentred.detail.summary!.cameraMoved).toBe(false);
    await page.waitForTimeout(300);
    expectCameraEqual(await camera(page), panned);

    // Under opt-out the fallback rebuild always keeps the current camera, document center and all.
    const rebuilt = await apply(page, "basemap");
    expect(rebuilt.type).toBe("ml-map:update-applied");
    expect(rebuilt.detail.summary!.rebuild).toBe(true);
    expectCameraEqual(await camera(page), panned);
    expect(errors).toEqual([]);
  });

  test("AE7: setState with an undeclared key reports an error naming it and changes nothing", async ({ page }) => {
    const errors = await open(page);
    const result = await page.evaluate(() => {
      const el = document.getElementById("map") as any;
      const before = JSON.stringify(el.getState());
      let message = "";
      try {
        el.setState({ month: 3 });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      return { before, after: JSON.stringify(el.getState()), message, global: el.getMap().getGlobalState?.() };
    });
    expect(result.message).toMatch(/month/);
    expect(result.before).toBe(JSON.stringify({ year: 2010 }));
    expect(result.after).toBe(result.before);
    expect(result.global?.month).toBeUndefined();
    expect((await eventTypes(page)).filter((t: string) => t === "ml-map:state-change")).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("AE8: setState moves the params panel slider and fires exactly one state-change event", async ({ page }) => {
    const errors = await open(page);
    const slider = page.locator("#map .ml-map-params input[type=range]");
    await expect(slider).toHaveValue("2010");
    expect(await townsDrawn(page)).toBe(3);
    const changesBefore = (await eventTypes(page)).filter((t: string) => t === "ml-map:state-change").length;

    const fired = await page.evaluate(
      () =>
        new Promise<{ values: Record<string, unknown>; changed: string[] }>((resolve) => {
          const el = document.getElementById("map") as any;
          el.addEventListener("ml-map:state-change", (e: Event) => resolve((e as CustomEvent).detail), { once: true });
          el.setState({ year: 2020 });
        })
    );
    expect(fired).toEqual({ values: { year: 2020 }, changed: ["year"] });
    await expect(slider).toHaveValue("2020");
    expect(await page.evaluate(() => (document.getElementById("map") as any).getState())).toEqual({ year: 2020 });
    await page.waitForTimeout(300);
    expect((await eventTypes(page)).filter((t: string) => t === "ml-map:state-change").length).toBe(changesBefore + 1);
    // The filter reading global-state saw the value: every town is founded by 2020.
    await expect.poll(() => townsDrawn(page)).toBe(5);
    expect(errors).toEqual([]);
  });

  test("AE9: a host setStyle with transformStyle keeps global-state filters evaluating against the current state", async ({
    page,
  }) => {
    const errors = await open(page);
    await rememberMap(page);
    await page.evaluate(() => (document.getElementById("map") as any).setState({ year: 2015 }));
    await expect.poll(() => townsDrawn(page)).toBe(4);
    const stateBefore = await page.evaluate(() => (document.getElementById("map") as any).getState());
    expect(stateBefore).toEqual({ year: 2015 });
    expect(await documentOrder(page)).toEqual(DOC_LAYERS);

    await page.evaluate(() => (window as any).__live.hostSetStyle());
    // The same map object, on the other basemap, with the document's layers carried over in document order.
    expect(await sameMap(page)).toBe(true);
    expect(
      await page.evaluate(() => (document.getElementById("map") as any).getMap().getPaintProperty("background", "background-color"))
    ).toBe("#dfe3ee");
    expect(await documentOrder(page)).toEqual(DOC_LAYERS);
    // The filter evaluates against the state values, not null: the same count as before the swap.
    await expect.poll(() => townsDrawn(page), { timeout: 20_000 }).toBe(4);
    expect(await page.evaluate(() => (document.getElementById("map") as any).getState())).toEqual(stateBefore);
    expect(await page.evaluate(() => (document.getElementById("map") as any).getMap().getGlobalState?.()?.year)).toBe(2015);
    // And the document is still live: a later edit applies in place on the swapped style.
    const after = await apply(page, "recolour");
    expect(after.type).toBe("ml-map:update-applied");
    expect(after.detail.summary!.failures).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("AE10: a JSON-equal document fires no event and changes nothing", async ({ page }) => {
    const errors = await open(page);
    await rememberMap(page);
    // One real edit first, so the element holds the key of a document it applied itself.
    expect((await apply(page, "recolour")).type).toBe("ml-map:update-applied");
    const before = await eventTypes(page);
    const style = () =>
      page.evaluate(() => JSON.stringify((document.getElementById("map") as any).getMap().getStyle().layers));
    const styleBefore = await style();
    const result = await page.evaluate(async () => {
      const el = document.getElementById("map") as any;
      const same = JSON.parse(JSON.stringify(el.getDocument()));
      el.config = same;
      const viaMethod = await el.update(JSON.parse(JSON.stringify(same)));
      await new Promise((r) => setTimeout(r, 500));
      return viaMethod;
    });
    expect(result.outcome).toBe("applied");
    expect(result.summary.propertiesSet).toEqual([]);
    expect(result.summary.moved).toEqual([]);
    expect(await eventTypes(page)).toEqual(before);
    expect(await style()).toBe(styleBefore);
    expect(await sameMap(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  test("AE10 (document from inline YAML): the first JSON-equal assignment fires no event either", async ({ page }) => {
    // A map rendered from inline YAML or `src` holds no applied-config key,
    // so an equal object reaches the renderer, whose diff finds nothing:
    // <ml-map> forwards the renderer's own `update:applied`, which never
    // fires for an unchanged document (R8).
    const errors = await open(page);
    const before = await eventTypes(page);
    await page.evaluate(async () => {
      const el = document.getElementById("map") as any;
      el.config = JSON.parse(JSON.stringify(el.getDocument()));
      await new Promise((r) => setTimeout(r, 500));
    });
    expect(await eventTypes(page)).toEqual(before);
    expect(errors).toEqual([]);
  });

  test("AE11: changed classify breaks recolour the layer and rewrite its legend entry", async ({ page }) => {
    const errors = await open(page);
    const legend = page.locator("#map .ml-map-legend");
    await expect(legend).toContainText("Population");
    const legendBefore = await legend.textContent();
    expect(legendBefore).toMatch(/1[,.  ]?000/);
    const paint = () =>
      page.evaluate(() => JSON.stringify((document.getElementById("map") as any).getMap().getPaintProperty("grades", "circle-color")));
    expect(await paint()).toContain("1000");

    const outcome = await apply(page, "reclassified");
    expect(outcome.type).toBe("ml-map:update-applied");
    expect(outcome.detail.summary!.failures).toEqual([]);
    await expect(legend).toContainText(/2[,.  ]?000/);
    await expect(legend).toContainText(/8[,.  ]?000/);
    expect(await legend.textContent()).not.toBe(legendBefore);
    expect(await paint()).toContain("2000");
    expect(await paint()).toContain("8000");
    expect(await paint()).not.toContain("1000");
    expect(errors).toEqual([]);
  });

  test("overlapping updates: three in one tick, the middle one is superseded and the last document wins", async ({
    page,
  }) => {
    const errors = await open(page);
    await rememberMap(page);
    const result = await page.evaluate(async () => {
      const live = (window as any).__live;
      const el = live.el;
      const base = el.getDocument();
      const outcomes = await Promise.all([
        el.update(live.docs.recolour(base, "#111111")),
        el.update(live.docs.recolour(base, "#222222")),
        el.update(live.docs.recolour(base, "#333333")),
      ]);
      return {
        outcomes: outcomes.map((o: { outcome: string }) => o.outcome),
        painted: el.getMap().getPaintProperty("towns", "circle-color"),
        document: el.getDocument().layers.find((l: any) => l.id === "towns").paint["circle-color"],
      };
    });
    expect(result.outcomes).toEqual(["applied", "superseded", "applied"]);
    expect(result.painted).toBe("#333333");
    expect(result.document).toBe("#333333");
    expect(await sameMap(page)).toBe(true);
    const applied = (await eventTypes(page)).filter((t: string) => t === "ml-map:update-applied");
    expect(applied).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  test("a basemap swap while the map is being panned lands at the camera the reader reached", async ({ page }) => {
    const errors = await open(page);
    await rememberMap(page);
    await page.evaluate(() => (window as any).__live.trackCamera());
    const start = await camera(page);
    // A 3 s ease is under way when the document changes its basemap.
    await page.evaluate(() =>
      (document.getElementById("map") as any).getMap().easeTo({ center: [10.9, 42.6], zoom: 8.4, duration: 3000, easing: (t: number) => t })
    );
    await page.waitForTimeout(400);
    const outcome = await apply(page, "basemap");
    expect(outcome.type).toBe("ml-map:update-applied");
    expect(outcome.detail.summary!.rebuild).toBe(true);
    expect(await sameMap(page)).toBe(false);
    const landed = await camera(page);
    const seen = await page.evaluate(() => (window as any).__live.lastSeen);
    // Where the old map was when it was last seen moving: not the start, not the document's camera.
    expect(landed.lng).toBeCloseTo(seen.center[0], 3);
    expect(landed.lat).toBeCloseTo(seen.center[1], 3);
    expect(landed.zoom).toBeCloseTo(seen.zoom, 3);
    expect(Math.abs(landed.lng - start.lng)).toBeGreaterThan(0.01);
    expect(Math.abs(landed.lng - 10.2)).toBeGreaterThan(0.01);
    // And it stays there: the new map is not easing anywhere.
    await page.waitForTimeout(500);
    expectCameraEqual(await camera(page), landed);
    expect(errors).toEqual([]);
  });
});
