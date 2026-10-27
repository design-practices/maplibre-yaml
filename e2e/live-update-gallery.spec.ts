/**
 * Live documents (ml-4ug, 0.10) — the real-pages sweep.
 *
 * @remarks
 * The fixture spec (live-update.spec.ts) proves the acceptance examples on
 * a document built for them. This spec drives the BUILT docs site: every
 * gallery, example and getting-started page that embeds an `<ml-map>`
 * (discovered from docs/dist, so a page added to the docs is swept
 * without a list to maintain), plus the home page and the playground.
 * For each page: load it, wait for `ml-map:load`, read `el.config`, apply a
 * paint-only edit (the first string colour in a layer's `paint:`, else
 * the first layer's `visible`; a layerless document gets a probe layer
 * added and removed), await `ml-map:update-applied`, and assert
 * no failures in the summary, no `ml-map:error`, no console error, the
 * same map object and an unmoved camera; then put the original back and
 * assert the document round-trips deep-equal. The playground is edited
 * through its editor, and the map must not reset its camera.
 *
 * Hermetic like the rest of the suite: docs/dist pages are served from
 * disk, a gallery config is answered with its hermetic twin from
 * examples/gallery/configs/ when one exists (same document shape, local
 * assets — the twin-fidelity rule), the demotiles/OpenFreeMap basemap
 * styles and the USGS feed are answered locally, and any other off-box
 * request is refused and recorded: a page that cannot load without the
 * network is reported as skipped, not failed. A per-page table is printed
 * at the end and written to e2e/results/live-update-gallery.json.
 * Requires the docs build (`pnpm build`, or `pnpm --filter docs build`).
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const REPO = join(__dirname, "..");
const DIST = join(REPO, "docs", "dist");
const TWINS = join(REPO, "examples", "gallery", "configs");
const LOCAL_STYLE = "/examples/verification/configs/local-style.json";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".geojson": "application/geo+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".pmtiles": "application/vnd.pmtiles",
  ".fgb": "application/octet-stream",
};

/** A stand-in for the USGS feed the home page and playground documents poll. */
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

interface SweepPage {
  /** The site path, e.g. `/examples/gallery/display-a-map/`. */
  path: string;
  kind: "map" | "story";
}

/** Every built page under the swept sections that embeds a map (or a story). */
function discoverPages(): SweepPage[] {
  if (!existsSync(join(DIST, "index.html"))) return [];
  const pages: SweepPage[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "index.html") {
        const site = full.slice(DIST.length).replace(/index\.html$/, "").replace(/\\/g, "/");
        if (!/^\/(examples\/|getting-started\/|$)/.test(site)) continue;
        const html = readFileSync(full, "utf8");
        // A real embed carries src= or config=; `<ml-map>` as prose in a
        // code block is escaped by the docs build and never matches.
        const hasMap = /<ml-map\s[^>]*\b(src|config)="/.test(html);
        const hasStory = /<ml-scrollytelling\b/.test(html);
        if (hasStory) pages.push({ path: site, kind: "story" });
        else if (hasMap) pages.push({ path: site, kind: "map" });
      }
    }
  };
  walk(DIST);
  return pages.sort((a, b) => a.path.localeCompare(b.path));
}

const PAGES = discoverPages();

interface Result {
  page: string;
  outcome: "passed" | "failed" | "skipped";
  notes: string[];
}
const results: Result[] = [];

/**
 * Serve the built site from disk, answer the basemaps and the feed locally,
 * swap a gallery config for its hermetic twin, refuse (and record) anything
 * else that would leave the box.
 */
async function serve(page: Page, baseURL: string): Promise<{ errors: string[]; external: Set<string> }> {
  const errors: string[] = [];
  const external = new Set<string>();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  let localStyle: string | null = null;
  await page.route("**/*", async (route: Route) => {
    const url = new URL(route.request().url());
    if (/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) {
      const path = decodeURIComponent(url.pathname);
      const twin = /^\/configs\/gallery\/([a-z0-9-]+)\.yaml$/.exec(path);
      if (twin && existsSync(join(TWINS, `${twin[1]}.yaml`))) {
        return route.fulfill({ body: readFileSync(join(TWINS, `${twin[1]}.yaml`), "utf8"), contentType: TYPES[".yaml"] });
      }
      const rel = path.endsWith("/") ? `${path}index.html` : path;
      const file = join(DIST, rel);
      if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) {
        return route.fulfill({ body: readFileSync(file), contentType: TYPES[extname(file)] ?? "application/octet-stream" });
      }
      return route.fallback();
    }
    if (/^(data|blob):/.test(url.protocol)) return route.fallback();
    if (
      url.href === "https://demotiles.maplibre.org/style.json" ||
      (url.origin === "https://tiles.openfreemap.org" && url.pathname.startsWith("/styles/"))
    ) {
      localStyle ??= await (await page.request.fetch(`${baseURL}${LOCAL_STYLE}`)).text();
      return route.fulfill({ body: localStyle, contentType: TYPES[".json"] });
    }
    if (url.hostname === "earthquake.usgs.gov") return route.fulfill({ json: QUAKES });
    if (url.hostname === "docs.maplibre-yaml.org") {
      const file = join(DIST, decodeURIComponent(url.pathname));
      if (file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) {
        return route.fulfill({
          body: readFileSync(file),
          headers: { "access-control-allow-origin": "*" },
          contentType: TYPES[extname(file)] ?? "application/octet-stream",
        });
      }
    }
    external.add(url.host);
    return route.abort();
  });
  return { errors, external };
}

/** Console lines that are only the echo of a request this spec refused. */
const refusedNoise = (line: string) => /net::ERR_FAILED|Failed to fetch|Failed to load resource|AJAXError|NetworkError|TypeError: Load failed/.test(line);

type Camera = { lng: number; lat: number; zoom: number; bearing: number; pitch: number };
const SWEEP = "ml-map[data-sweep]";

const camera = (page: Page): Promise<Camera> =>
  page.evaluate((sel) => {
    const map = (document.querySelector(sel) as any).getMap();
    const c = map.getCenter();
    return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  }, SWEEP);

const sameCamera = (a: Camera, b: Camera, tol = 1e-6) =>
  Math.abs(a.lng - b.lng) < tol &&
  Math.abs(a.lat - b.lat) < tol &&
  Math.abs(a.zoom - b.zoom) < tol &&
  Math.abs(a.bearing - b.bearing) < tol &&
  Math.abs(a.pitch - b.pitch) < tol;

/** Hand the swept element a document and resolve with its next `ml-map:update-*` event (or a timeout). */
function applyOn(page: Page, doc: unknown): Promise<{ type: string; detail: any } | { type: "timeout" }> {
  return page.evaluate(
    ([sel, doc]) =>
      new Promise((resolve) => {
        const el = document.querySelector(sel) as any;
        const timer = setTimeout(() => {
          cleanup();
          resolve({ type: "timeout" });
        }, 30_000);
        const done = (event: Event) => {
          cleanup();
          resolve({ type: event.type, detail: (event as CustomEvent).detail });
        };
        const cleanup = () => {
          clearTimeout(timer);
          el.removeEventListener("ml-map:update-applied", done);
          el.removeEventListener("ml-map:update-rejected", done);
        };
        el.addEventListener("ml-map:update-applied", done);
        el.addEventListener("ml-map:update-rejected", done);
        el.config = doc;
      }),
    [SWEEP, doc] as const
  );
}

test.describe("live documents on the real docs pages (ml-4ug)", () => {
  test.use({ viewport: { width: 900, height: 700 } });
  test.describe.configure({ timeout: 150_000 });

  const JSONL = join(REPO, "e2e", "results", "live-update-gallery.jsonl");

  test.beforeAll(() => {
    // Playwright restarts the worker after a failure, so results are
    // appended per test to a JSONL file the first worker starts afresh.
    mkdirSync(join(REPO, "e2e", "results"), { recursive: true });
    if (process.env.TEST_WORKER_INDEX === "0") writeFileSync(JSONL, "");
    expect(
      existsSync(join(DIST, "index.html")),
      "docs/dist is missing — build the docs first (pnpm build, or pnpm --filter docs build)"
    ).toBe(true);
    expect(PAGES.length, "no pages with an <ml-map> found under docs/dist").toBeGreaterThan(0);
  });

  test.afterEach(() => {
    const last = results.at(-1);
    if (last) appendFileSync(JSONL, `${JSON.stringify(last)}\n`);
  });

  test.afterAll(() => {
    // Every result so far, this worker's and earlier workers' alike.
    const all: Result[] = existsSync(JSONL)
      ? readFileSync(JSONL, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Result)
      : results;
    const line = (r: Result) => `| ${r.page} | ${r.outcome} | ${r.notes.join("; ").replace(/\|/g, "/") || "—"} |`;
    const table = ["| page | outcome | notes |", "|---|---|---|", ...all.map(line)].join("\n");
    const counts = {
      passed: all.filter((r) => r.outcome === "passed").length,
      failed: all.filter((r) => r.outcome === "failed").length,
      skipped: all.filter((r) => r.outcome === "skipped").length,
    };
    console.log(`\n[live-update-gallery] ${all.length} pages so far: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped\n${table}\n`);
    writeFileSync(join(REPO, "e2e", "results", "live-update-gallery.json"), JSON.stringify({ counts, results: all }, null, 2));
  });

  for (const { path, kind } of PAGES) {
    test(`${path} — a paint edit applies in place and the original round-trips`, async ({ page, baseURL }) => {
      const result: Result = { page: path, outcome: "failed", notes: [] };
      results.push(result);
      if (kind === "story") {
        result.outcome = "skipped";
        result.notes.push("story page: its map is driven by <ml-scrollytelling> (covered in scrollytelling.spec.ts)");
        test.skip(true, result.notes[0]);
      }
      const { errors, external } = await serve(page, baseURL!);
      await page.goto(path, { waitUntil: "domcontentloaded" });

      // The page's first real embed is the one swept.
      const target = page.locator("ml-map[src], ml-map[config]").first();
      await expect(target).toHaveCount(1);
      await target.evaluate((el) => el.setAttribute("data-sweep", ""));
      const count = await page.locator("ml-map[src], ml-map[config]").count();
      if (count > 1) result.notes.push(`${count} maps on the page; the first was swept`);

      // ml-map:load, through the promise that resolves on it.
      const loaded = await page.evaluate(
        (sel) =>
          Promise.race([
            (document.querySelector(sel) as any).mapReady().then(() => "loaded"),
            new Promise<string>((r) => setTimeout(() => r("timeout"), 60_000)),
          ]).catch((e: unknown) => `failed: ${e instanceof Error ? e.message : String(e)}`),
        SWEEP
      );
      if (loaded !== "loaded") {
        const needsNetwork = external.size > 0;
        result.outcome = needsNetwork ? "skipped" : "failed";
        result.notes.push(`map did not load (${loaded})${needsNetwork ? `; needs network: ${[...external].join(", ")}` : ""}`);
        if (needsNetwork) test.skip(true, result.notes.join("; "));
        expect(loaded, result.notes.join("; ")).toBe("loaded");
      }
      // A settled frame, bounded: page JS may keep a source busy forever.
      await page.evaluate(
        (sel) =>
          new Promise<void>((resolve) => {
            const map = (document.querySelector(sel) as any).getMap();
            const t = setTimeout(resolve, 15_000);
            map.once("idle", () => {
              clearTimeout(t);
              resolve();
            });
            map.triggerRepaint();
          }),
        SWEEP
      );
      if (external.size) result.notes.push(`refused off-box requests during load: ${[...external].join(", ")}`);
      const loadErrors = errors.filter((e) => !refusedNoise(e));
      if (loadErrors.length) result.notes.push(`errors while loading: ${loadErrors.slice(0, 2).join(" / ")}`);

      // A document layer the first render could not add (its source is in
      // a basemap this suite answers with the source-less local style, or
      // behind a refused request) is an environment limit, not an update
      // failure: the page is skipped, named.
      const missing: string[] = await page.evaluate((sel) => {
        const el = document.querySelector(sel) as any;
        const map = el.getMap();
        return (el.getDocument()?.layers ?? []).map((l: any) => l.id).filter((id: string) => !map.getLayer(id));
      }, SWEEP);
      if (missing.length) {
        result.outcome = "skipped";
        result.notes.push(`document layers missing after load (hermetic basemap stand-in / refused data): ${missing.join(", ")}`);
        test.skip(true, result.notes.join("; "));
      }

      // Is page JavaScript moving the camera? Then the camera is not compared.
      const c1 = await camera(page);
      await page.waitForTimeout(300);
      const c2 = await camera(page);
      const animated = !sameCamera(c1, c2);
      if (animated) result.notes.push("camera animated by page JS: not compared");

      // From here on, every ml-map:error and console error counts.
      const errorsBefore = errors.length;
      await page.evaluate((sel) => {
        const el = document.querySelector(sel) as any;
        (window as any).__sweep = { map: el.getMap(), mlErrors: [] as string[] };
        el.addEventListener("ml-map:error", (e: Event) => {
          const d = (e as CustomEvent).detail ?? {};
          (window as any).__sweep.mlErrors.push(String(d.error?.message ?? d.errors?.[0]?.message ?? "error"));
        });
      }, SWEEP);

      // The edit: the first string colour in a layer's paint, else the first layer's visibility.
      const plan = await page.evaluate((sel) => {
        const el = document.querySelector(sel) as any;
        const original = JSON.parse(JSON.stringify(el.getDocument()));
        const next = JSON.parse(JSON.stringify(original));
        for (const layer of next.layers ?? []) {
          const paint = layer.paint;
          if (!paint || typeof paint !== "object") continue;
          for (const key of Object.keys(paint)) {
            if (key.endsWith("-color") && typeof paint[key] === "string") {
              paint[key] = "#ff00ff";
              return { original, next, layerId: layer.id, property: key, kind: "paint", was: original.layers.find((l: any) => l.id === layer.id).paint[key] };
            }
          }
        }
        const first = next.layers?.[0];
        if (first) {
          first.visible = first.visible === false;
          return { original, next, layerId: first.id, property: "visibility", kind: "visible", was: original.layers[0].visible !== false };
        }
        // No layers at all (a camera, controls or markers page): the edit
        // adds one small inline layer at the document's centre, and the
        // restore removes it again.
        const center = el.getMap().getCenter();
        next.layers = [
          {
            id: "sweep-probe",
            type: "circle",
            source: {
              type: "geojson",
              data: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [center.lng, center.lat] } },
            },
            paint: { "circle-radius": 6, "circle-color": "#ff00ff" },
          },
        ];
        return { original, next, layerId: "sweep-probe", property: "circle-color", kind: "add", was: null };
      }, SWEEP);
      const { original, next, layerId, property, kind: editKind } = plan;
      result.notes.push(editKind === "add" ? "no layers: added and removed a probe layer" : `edited ${layerId}.${property}`);

      const problems: string[] = [];
      const check = (label: string, outcome: Awaited<ReturnType<typeof applyOn>>) => {
        if (outcome.type !== "ml-map:update-applied") {
          problems.push(`${label}: ${outcome.type}${"detail" in outcome ? ` ${JSON.stringify(outcome.detail).slice(0, 300)}` : ""}`);
          return;
        }
        const s = outcome.detail.summary;
        if (s.rebuild) problems.push(`${label}: summary.rebuild for a paint-only edit`);
        if (s.failures.length) problems.push(`${label}: failures ${JSON.stringify(s.failures).slice(0, 300)}`);
      };

      // 1. The edit.
      check("edit", await applyOn(page, next));
      const afterEdit = await page.evaluate(
        ([sel, layerId, property, editKind]) => {
          const el = document.querySelector(sel) as any;
          const map = el.getMap();
          return {
            sameMap: map === (window as any).__sweep.map,
            value:
              editKind === "visible"
                ? map.getLayoutProperty(layerId, "visibility")
                : map.getLayer(layerId)
                  ? map.getPaintProperty(layerId, property)
                  : undefined,
            mlErrors: (window as any).__sweep.mlErrors as string[],
          };
        },
        [SWEEP, layerId, property, editKind] as const
      );
      if (!afterEdit.sameMap) problems.push("edit: getMap() is a different object");
      if ((editKind === "paint" || editKind === "add") && afterEdit.value !== "#ff00ff") problems.push(`edit: ${layerId}.${property} is ${JSON.stringify(afterEdit.value)}, not #ff00ff`);
      if (editKind === "visible" && afterEdit.value !== (plan.was ? "none" : "visible")) problems.push(`edit: visibility is ${JSON.stringify(afterEdit.value)}`);
      if (!animated) {
        const c3 = await camera(page);
        if (!sameCamera(c3, c2)) problems.push(`edit: camera moved from ${JSON.stringify(c2)} to ${JSON.stringify(c3)}`);
      }

      // 2. The original back.
      check("restore", await applyOn(page, original));
      const afterRestore = await page.evaluate(
        ([sel, layerId, property, editKind, original]) => {
          const el = document.querySelector(sel) as any;
          const map = el.getMap();
          return {
            sameMap: map === (window as any).__sweep.map,
            roundTrip: JSON.stringify(el.getDocument()) === JSON.stringify(original),
            value:
              editKind === "add"
                ? Boolean(map.getLayer(layerId))
                : editKind === "paint"
                  ? map.getPaintProperty(layerId, property)
                  : map.getLayoutProperty(layerId, "visibility"),
            mlErrors: (window as any).__sweep.mlErrors as string[],
          };
        },
        [SWEEP, layerId, property, editKind, original] as const
      );
      if (!afterRestore.sameMap) problems.push("restore: getMap() is a different object");
      if (!afterRestore.roundTrip) problems.push("restore: getDocument() is not deep-equal to the original");
      if (editKind === "paint" && JSON.stringify(afterRestore.value) !== JSON.stringify(plan.was)) {
        problems.push(`restore: ${layerId}.${property} is ${JSON.stringify(afterRestore.value)}, not ${JSON.stringify(plan.was)}`);
      }
      if (editKind === "add" && afterRestore.value !== false) problems.push("restore: the probe layer is still on the map");
      if (!animated) {
        const c4 = await camera(page);
        if (!sameCamera(c4, c2)) problems.push(`restore: camera moved to ${JSON.stringify(c4)}`);
      }
      if (afterRestore.mlErrors.length) problems.push(`ml-map:error during the updates: ${afterRestore.mlErrors.join(" / ")}`);
      const newErrors = errors.slice(errorsBefore).filter((e) => !refusedNoise(e));
      if (newErrors.length) problems.push(`console/page errors during the updates: ${newErrors.slice(0, 3).join(" / ")}`);

      result.notes.push(...problems);
      result.outcome = problems.length ? "failed" : "passed";
      expect(problems, `${path}\n${problems.join("\n")}`).toEqual([]);
    });
  }

  test("/playground/ — an edit in the editor updates the map in place and keeps the reader's camera", async ({
    page,
    baseURL,
  }) => {
    const result: Result = { page: "/playground/ (editor)", outcome: "failed", notes: [] };
    results.push(result);
    expect(existsSync(join(DIST, "playground", "index.html")), "docs/dist/playground is missing — build the docs first").toBe(true);
    const { errors } = await serve(page, baseURL!);
    await page.goto("/playground/?src=/configs/earthquakes.yaml", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".pg-root")).toHaveAttribute("data-editor", "ready", { timeout: 60_000 });
    const MAP = "#pg-preview ml-map";
    await page.waitForFunction(
      (sel) => {
        const map = (document.querySelector(sel) as any)?.getMap?.();
        return Boolean(map && map.isStyleLoaded?.() && map.getLayer?.("earthquakes"));
      },
      MAP,
      { timeout: 60_000 }
    );
    await expect(page.locator("#pg-status-text")).toHaveText("Map updated · no problems");
    await page.locator(MAP).evaluate((el) => el.setAttribute("data-sweep", ""));

    // The reader pans; the author edits a colour in the editor.
    await page.evaluate((sel) => (document.querySelector(sel) as any).getMap().jumpTo({ center: [139.7, 35.7], zoom: 4 }), MAP);
    const panned = await camera(page);
    await page.evaluate((sel) => ((window as any).__pgMap = (document.querySelector(sel) as any).getMap()), MAP);
    const rendersBefore = Number(await page.locator(".pg-root").getAttribute("data-renders"));
    const applied = page.evaluate(
      (sel) =>
        new Promise<{ summary: { propertiesSet: unknown[]; rebuild: boolean; failures: unknown[]; cameraMoved: boolean } }>((resolve) =>
          (document.querySelector(sel) as any).addEventListener("ml-map:update-applied", (e: CustomEvent) => resolve(e.detail), { once: true })
        ),
      MAP
    );
    await page.locator(".cm-scroller").evaluate((el) => (el.scrollTop = 0));
    const line = page.locator(".cm-line", { hasText: /circle-color:/ }).first();
    await expect(line).toBeVisible();
    await line.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.insertText('circle-color: "#2563eb"');
    const { summary } = await applied;
    expect(summary.rebuild).toBe(false);
    expect(summary.failures).toEqual([]);
    expect(summary.cameraMoved).toBe(false);
    expect(summary.propertiesSet).toEqual([{ layerId: "earthquakes", property: "circle-color" }]);
    await expect.poll(() => page.locator(".pg-root").getAttribute("data-renders").then(Number)).toBeGreaterThan(rendersBefore);
    expect(await page.evaluate((sel) => (document.querySelector(sel) as any).getMap() === (window as any).__pgMap, MAP)).toBe(true);
    expect(await page.evaluate((sel) => (document.querySelector(sel) as any).getMap().getPaintProperty("earthquakes", "circle-color"), MAP)).toBe("#2563eb");
    const kept = await camera(page);
    expect(sameCamera(kept, panned, 1e-4), `camera ${JSON.stringify(kept)} vs ${JSON.stringify(panned)}`).toBe(true);
    await expect(page.locator("#pg-status-text")).toHaveText("Map updated · no problems");
    const problems = errors.filter((e) => !refusedNoise(e));
    result.outcome = problems.length ? "failed" : "passed";
    result.notes.push("edited earthquakes.circle-color through the editor", ...problems);
    expect(problems).toEqual([]);
  });
});
