/**
 * <ml-map> puts student mistakes on the page (ml-aot.13/14/15): the error
 * card for a document that cannot render (a `src` that will not load, a
 * basemap style that never loads), and the dismissible notice for parts of a
 * working map that failed (a rejected layer, a data file that 404'd).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("maplibre-gl", () => ({ default: {}, Map: vi.fn() }));

/** The last renderer the element built: its options and event handlers. */
interface FakeRenderer {
  options: any;
  handlers: Map<string, Array<(payload: any) => void>>;
  emit(name: string, payload?: any): void;
}
const renderers: FakeRenderer[] = [];

vi.mock("../../src/renderer/map-renderer", () => ({
  MapRenderer: vi.fn().mockImplementation((_container, _config, _layers, options) => {
    const handlers = new Map<string, Array<(payload: any) => void>>();
    const fake: FakeRenderer & Record<string, unknown> = {
      options,
      handlers,
      emit(name: string, payload?: any) {
        for (const fn of handlers.get(name) ?? []) fn(payload);
      },
      getMap: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
      destroy: vi.fn(),
      isMapLoaded: vi.fn(() => false),
      on: vi.fn((name: string, fn: (payload: any) => void) => {
        handlers.set(name, [...(handlers.get(name) ?? []), fn]);
      }),
    };
    renderers.push(fake);
    return fake;
  }),
}));

import { MLMap } from "../../src/components/ml-map";

const CONFIG = {
  type: "map",
  id: "m",
  config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/styles.json" },
  layers: [],
};

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

async function mount(attrs: Record<string, string> = {}): Promise<MLMap> {
  const el = document.createElement("ml-map") as MLMap;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (!("src" in attrs)) el.setAttribute("config", JSON.stringify(CONFIG));
  document.body.appendChild(el);
  await tick();
  return el;
}

const latest = () => renderers[renderers.length - 1]!;
const cardText = (el: MLMap) => el.querySelector(".ml-map-error")?.textContent?.replace(/\s+/g, " ").trim();
const noticeText = (el: MLMap) => el.querySelector(".ml-map-notice")?.textContent?.replace(/\s+/g, " ").trim();

describe("<ml-map> on-page errors", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    document.body.innerHTML = "";
    renderers.length = 0;
    if (!customElements.get("ml-map")) customElements.define("ml-map", MLMap);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    globalThis.fetch = realFetch;
  });

  describe("a basemap style that never loads (ml-aot.14)", () => {
    it("replaces the map with a card naming the URL and the status, and mapReady() rejects", async () => {
      const el = await mount();
      const ready = el.mapReady();
      const failure = Object.assign(new Error("AJAXError: Not Found (404): https://example.com/styles.json"), {
        status: 404,
        statusText: "Not Found",
      });
      latest().options.onError(failure, true, { kind: "style", url: "https://example.com/styles.json" });
      await expect(ready).rejects.toThrow(/404/);
      await tick();

      expect(cardText(el)).toContain("The basemap style didn't load");
      expect(cardText(el)).toContain(
        'config.mapStyle: Could not load the basemap style "https://example.com/styles.json": 404 Not Found.'
      );
      expect(cardText(el)).toContain("How to fix it: Check config.mapStyle");
      expect(el.querySelector(".ml-map-error")?.getAttribute("role")).toBe("alert");
      // A late subscriber rejects too.
      await expect(el.mapReady()).rejects.toThrow(/404/);
    });

    it("several validation errors from one style show as one card", async () => {
      const el = await mount();
      const { onError } = latest().options;
      onError(new Error("version: missing required property"), true, { kind: "style", url: "https://example.com/styles.json" });
      onError(new Error("sources: missing required property"), true, { kind: "style", url: "https://example.com/styles.json" });
      await tick();
      expect(el.querySelectorAll(".ml-map-error")).toHaveLength(1);
      expect(cardText(el)).toContain("isn't a valid MapLibre style: version: missing required property (and 1 more problem)");
    });
  });

  describe("non-fatal layer problems (ml-aot.15)", () => {
    it("a rejected layer goes in the notice, not a card; the map stays", async () => {
      const el = await mount();
      latest().options.onError(
        new Error('layers.cities.paint.circle-color: color expected, "bleu" found'),
        false,
        { kind: "layer", layerId: "cities" }
      );
      expect(el.querySelector(".ml-map-error")).toBeNull();
      expect(el.querySelector(".ml-map-container")).not.toBeNull();
      const notice = el.querySelector(".ml-map-notice")!;
      expect(notice.getAttribute("role")).toBe("status");
      expect(noticeText(el)).toContain("Part of this map couldn't load");
      expect(noticeText(el)).toContain(
        'Layer cities didn\'t draw: paint.circle-color: color expected, "bleu" found. Did you mean "blue"?'
      );
      expect(notice.querySelector("code")?.textContent).toBe("cities");
    });

    it("a data file that 404'd is listed with the URL the browser tried, and logged", async () => {
      const el = await mount();
      const error = Object.assign(new Error("HTTP 404: Not Found for data/x.geojson"), { url: "data/x.geojson" });
      latest().emit("layer:data-error", { layerId: "quakes", error });
      expect(noticeText(el)).toContain("Data file data/x.geojson didn't load (404 Not Found), so layer quakes has no data.");
      expect(noticeText(el)).toContain(`The browser looked for ${new URL("data/x.geojson", document.baseURI).href}`);
      expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('Data file "data/x.geojson"'))).toBe(true);
    });

    it("a fitTo.source typo shows a notice with the did-you-mean, not only a console line (ml-aot.51)", async () => {
      const el = await mount();
      latest().options.onError(new Error('fitTo.source "place" names no entry in `sources:`'), false, {
        kind: "fit",
        sourceId: "place",
        suggestion: "places",
      });
      expect(noticeText(el)).toContain(
        'fitTo.source "place" names no source in sources: — did you mean "places"? The map keeps its own center and zoom.'
      );
    });

    it("classified breaks that can't be computed (a source read by view) show one notice", async () => {
      const el = await mount();
      const { byViewClassifyError } = await import("../../src/renderer/classify-runtime");
      latest().options.onError(byViewClassifyError("income", "parcels", "`mlym breaks parcels.fgb --field income --method jenks`"), false, {
        kind: "classify",
        layerId: "income",
        sourceId: "parcels",
      });
      expect(noticeText(el)).toContain("can't compute its classes");
      expect(noticeText(el)).toContain("breaks:");
      expect(noticeText(el)).toContain("mlym breaks parcels.fgb --field income --method jenks");
      // The Large data guide's section on class breaks, as a link (U5).
      expect(el.querySelector<HTMLAnchorElement>(".ml-map-notice a")?.href).toBe(
        "https://docs.maplibre-yaml.org/guides/large-data/#class-breaks"
      );
    });

    it("a classified field the data has no value for is an author hint on the page (ml-aot.95)", async () => {
      const el = await mount();
      latest().options.onError(
        new Error('Layer `income`: classify field: "Median_Income" is not a property of any feature.'),
        false,
        { kind: "classify-field", layerId: "income" }
      );
      expect(noticeText(el)).toContain('"Median_Income" is not a property of any feature');
    });

    it("the same problem is listed once; dismissing hides the notice", async () => {
      const el = await mount();
      const report = () =>
        latest().options.onError(new Error("layers.a.paint.x: bad"), false, { kind: "layer", layerId: "a" });
      report();
      report();
      expect(el.querySelectorAll(".ml-map-notice li")).toHaveLength(1);
      (el.querySelector(".ml-map-notice button") as HTMLButtonElement).click();
      expect(el.querySelector(".ml-map-notice")).toBeNull();
    });

    it("errors that are not the document's (a basemap tile) stay off the page", async () => {
      const el = await mount();
      latest().options.onError(new Error("AJAXError: Not Found (404): https://tiles/1/2/3.pbf"), false, undefined);
      expect(el.querySelector(".ml-map-notice")).toBeNull();
    });

    it("`quiet` keeps the notice off the page but still logs", async () => {
      const el = await mount({ quiet: "" });
      expect(el.quiet).toBe(true);
      const error = Object.assign(new Error("HTTP 404: Not Found for d.geojson"), { url: "d.geojson" });
      latest().emit("layer:data-error", { layerId: "l", error });
      expect(el.querySelector(".ml-map-notice")).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
    });

    it("`quiet` also keeps document warnings shown on the page (a key under config:) off it", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const misplaced = { ...CONFIG, config: { ...CONFIG.config, markers: [{ at: [1, 1] }] } };
      const loud = document.createElement("ml-map") as MLMap;
      loud.setAttribute("config", JSON.stringify(misplaced));
      document.body.appendChild(loud);
      const hushed = document.createElement("ml-map") as MLMap;
      hushed.setAttribute("quiet", "");
      hushed.setAttribute("config", JSON.stringify(misplaced));
      document.body.appendChild(hushed);
      await tick();
      expect(noticeText(loud)).toContain('"markers" belongs at the top level');
      expect(hushed.querySelector(".ml-map-notice")).toBeNull();
      expect(warn.mock.calls.some((c) => String(c[0]).includes('"markers" belongs at the top level'))).toBe(true);
      warn.mockRestore();
    });

    it("setting `quiet` later removes a notice already shown", async () => {
      const el = await mount();
      latest().options.onError(new Error("layers.a.paint.x: bad"), false, { kind: "layer", layerId: "a" });
      expect(el.querySelector(".ml-map-notice")).not.toBeNull();
      el.quiet = true;
      expect(el.hasAttribute("quiet")).toBe(true);
      expect(el.querySelector(".ml-map-notice")).toBeNull();
    });
  });

  describe("large-data hints point at the Large data guide, with its commands (0.10 U5, R12, KTD14)", () => {
    const guide = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/src/content/docs/guides/large-data.mdx"),
      "utf8"
    );
    /** The shell commands in a hint: its backtick-quoted spans. */
    const commands = (hint: string) => [...hint.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

    it("LARGE_DATA_DOCS names the guide and the anchors the hints link", async () => {
      const { LARGE_DATA_DOCS } = await import("../../src/components/student-messages");
      const page = "https://docs.maplibre-yaml.org/guides/large-data/";
      expect(LARGE_DATA_DOCS).toMatchObject({
        guide: page,
        whichFormat: `${page}#which-format`,
        prepare: `${page}#mlym-prepare`,
        pmtiles: `${page}#parcel-fabrics-pmtiles`,
        overviews: `${page}#overview-geoparquet`,
        classBreaks: `${page}#class-breaks`,
        mlt: `${page}#mlt-tiles`,
      });
      for (const url of Object.values(LARGE_DATA_DOCS).filter((u) => u.startsWith(page) && u.includes("#"))) {
        expect(guide).toContain(`\\{${url.slice(url.indexOf("#"))}}`);
      }
    });

    it("the overview-file and PMTiles commands are the guide's, one per route", async () => {
      const { overviewsCommand, pmtilesCommand } = await import("../../src/components/student-messages");
      expect(commands(overviewsCommand("stops.parquet"))).toEqual([
        "uv run --with tylertoo==0.8.0 python -c \"import tylertoo as t; t.overview('stops.parquet', 'stops-ov.parquet', min_zoom=0, max_zoom=14, collapse_square=True)\"",
      ]);
      // From GeoJSON or FlatGeobuf: converted to GeoParquet first, as in the guide.
      const [convert, overview] = commands(overviewsCommand("stops.geojson", "geojson"));
      for (const line of [convert, overview, ...commands(pmtilesCommand("parcels.geojson", "geojson"))]) {
        expect(guide).toContain(line);
      }
      // The PMTiles recipe starts with the overview-file command's call.
      expect(pmtilesCommand("lots.parquet", "geoparquet")).toContain(
        overviewsCommand("lots.parquet").replace(/"`$/, "")
      );
    });

    it("a large-data hint's guide link is a link in the notice", async () => {
      const el = await mount();
      const { largeDataLinks } = await import("../../src/components/student-messages");
      latest().options.onError(new Error(`\`lots.parquet\` is too dense. ${largeDataLinks("geoparquet", "overviews")}`), false, {
        kind: "source-hint",
        sourceId: "lots",
      });
      const links = [...el.querySelectorAll<HTMLAnchorElement>(".ml-map-notice a")].map((a) => a.href);
      expect(links).toEqual([
        "https://docs.maplibre-yaml.org/guides/geoparquet/#large-files",
        "https://docs.maplibre-yaml.org/guides/large-data/#overview-geoparquet",
      ]);
    });
  });

  describe("src fetch failures (ml-aot.13)", () => {
    it("a 404 shows the resolved URL", async () => {
      globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found" })) as any;
      const el = await mount({ src: "maps/city.yaml" });
      expect(cardText(el)).toContain("Map file not found");
      expect(cardText(el)).toContain('Couldn\'t load src="maps/city.yaml": 404 Not Found.');
      expect(cardText(el)).toContain(`The browser looked for it at ${new URL("maps/city.yaml", document.baseURI).href}`);
    });

    it("an HTML body (an SPA fallback) says the path is probably wrong — not a YAML syntax error", async () => {
      globalThis.fetch = vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "<!doctype html><html><body></body></html>",
      })) as any;
      const el = await mount({ src: "nope.yaml" });
      expect(cardText(el)).toContain('src="nope.yaml" points at an HTML page, not a YAML file');
      expect(cardText(el)).not.toContain("YAML syntax error");
    });

    it("a network failure over http names the URL", async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }) as any;
      const el = await mount({ src: "map.yaml" });
      expect(cardText(el)).toContain("Couldn't load the map file");
      expect(cardText(el)).toContain('Couldn\'t load src="map.yaml"');
    });

    it("dispatches ml-map:error with the structured errors", async () => {
      globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found" })) as any;
      const el = document.createElement("ml-map") as MLMap;
      el.setAttribute("src", "x.yaml");
      const seen: unknown[] = [];
      el.addEventListener("ml-map:error", (e) => seen.push(e.detail));
      document.body.appendChild(el);
      await tick();
      expect(seen).toEqual([
        {
          errors: [
            { path: "", message: 'Couldn\'t load src="x.yaml": 404 Not Found.' },
            { path: "", message: `The browser looked for it at ${new URL("x.yaml", document.baseURI).href}` },
          ],
        },
      ]);
    });
  });

  describe("the error card", () => {
    it("shows the YAML line of a validation error", async () => {
      const el = document.createElement("ml-map") as MLMap;
      const script = document.createElement("script");
      script.type = "text/yaml";
      script.textContent = "type: map\nid: m\nconfig:\n  centre: [0, 0]\n  zoom: 2\n  mapStyle: \"https://x/s.json\"\n";
      el.appendChild(script);
      document.body.appendChild(el);
      await tick();
      expect(cardText(el)).toContain('config.centre: Unknown key "centre" — did you mean "center"? ("center" is required here.) (line 4)');
    });
  });
});
