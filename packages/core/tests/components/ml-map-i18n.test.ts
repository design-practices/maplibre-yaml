/**
 * <ml-map> in the document's language (0.9): one `locale:` table covers
 * MapLibre's controls (passed through to the renderer untouched) and the
 * library's own strings — the notice, error cards, the height hint — and
 * the document's title/description reach the renderer.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("maplibre-gl", () => ({ default: {}, Map: vi.fn() }));

interface FakeRenderer {
  config: any;
  options: any;
}
const renderers: FakeRenderer[] = [];

vi.mock("../../src/renderer/map-renderer", () => ({
  MapRenderer: vi.fn().mockImplementation((_container, config, _layers, options) => {
    const fake = {
      config,
      options,
      getMap: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
      destroy: vi.fn(),
      isMapLoaded: vi.fn(() => false),
      on: vi.fn(),
    };
    renderers.push(fake);
    return fake;
  }),
}));

import { MLMap } from "../../src/components/ml-map";
import { MapNotice } from "../../src/components/map-notice";
import { createStrings } from "../../src/i18n";

const SPANISH = {
  "NavigationControl.ZoomIn": "Acercar",
  "maplibre-yaml.Notice.Title": "Parte de este mapa no se pudo cargar",
  "maplibre-yaml.Notice.AuthorDetails": "Detalles para quien hizo el sitio",
  "maplibre-yaml.Notice.Dismiss": "Cerrar este aviso",
  "maplibre-yaml.ErrorCard.StyleNotLoaded": "El estilo del mapa base no se cargó",
  "maplibre-yaml.ErrorCard.HowToFix": "Cómo arreglarlo:",
};

const v1 = (extra: Record<string, unknown> = {}) => ({
  type: "map",
  id: "m",
  title: "Calor en el Bronx",
  description: "Zonas censales sombreadas de amarillo pálido a rojo oscuro.",
  config: {
    center: [0, 0],
    zoom: 2,
    mapStyle: "https://example.com/styles.json",
    locale: SPANISH,
  },
  layers: [],
  ...extra,
});

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const latest = () => renderers[renderers.length - 1]!;

async function mount(config: unknown): Promise<MLMap> {
  const el = document.createElement("ml-map") as MLMap;
  el.setAttribute("config", JSON.stringify(config));
  document.body.appendChild(el);
  await tick();
  return el;
}

describe("<ml-map> languages and accessible name", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    renderers.length = 0;
    if (!customElements.get("ml-map")) customElements.define("ml-map", MLMap);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => errorSpy.mockRestore());

  it("passes the title and description to the renderer, and the whole locale table to MapLibre", async () => {
    await mount(v1());
    expect(latest().options.title).toBe("Calor en el Bronx");
    expect(latest().options.description).toContain("Zonas censales");
    expect(latest().config.locale).toEqual(SPANISH);
  });

  it("v2: the same, from runtime.map.locale", async () => {
    await mount({
      version: 2,
      type: "map",
      id: "m",
      title: "Calor",
      style: { basemap: "https://example.com/styles.json", center: [0, 0], zoom: 2 },
      runtime: { map: { locale: SPANISH } },
    });
    expect(latest().options.title).toBe("Calor");
    expect(latest().config.locale).toEqual(SPANISH);
  });

  it("the notice speaks the document's language", async () => {
    const el = await mount(v1());
    latest().options.onError(new Error("layers.x.paint.circle-color: bad"), false, {
      kind: "layer",
      layerId: "x",
    });
    const notice = el.querySelector(".ml-map-notice")!;
    expect(notice.querySelector("strong")!.textContent).toBe("Parte de este mapa no se pudo cargar");
    expect(notice.querySelector("summary")!.textContent).toBe("Detalles para quien hizo el sitio");
    expect(notice.querySelector("button")!.getAttribute("aria-label")).toBe("Cerrar este aviso");
  });

  it("a hints-only notice (ml-aot.57) leads with the translated hints title, then the failure title", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const notice = new MapNotice(host, {
      openDetails: true,
      strings: createStrings({
        ...SPANISH,
        "maplibre-yaml.Notice.HintsTitle": "Notas para quien hizo este mapa",
      }),
    });
    notice.add("`centre` is not a key. Did you mean `center`?", "hint");
    expect(host.querySelector(".ml-map-notice strong")!.textContent).toBe("Notas para quien hizo este mapa");
    notice.add("Data file `x.geojson` didn't load.", "failure");
    expect(host.querySelector(".ml-map-notice strong")!.textContent).toBe("Parte de este mapa no se pudo cargar");
    expect(host.querySelector(".ml-map-notice summary")!.textContent).toBe("Detalles para quien hizo el sitio");
  });

  it("an error card for a document that was read is translated too", async () => {
    const el = await mount(v1());
    latest().options.onError(Object.assign(new Error("Not Found"), { status: 404 }), true, {
      kind: "style",
      url: "https://example.com/styles.json",
    });
    await tick();
    const card = el.querySelector(".ml-map-error")!.textContent!.replace(/\s+/g, " ");
    expect(card).toContain("El estilo del mapa base no se cargó");
    expect(card).toContain("Cómo arreglarlo:");
  });

  it("uiString(): the document's strings for host chrome, English defaults otherwise", async () => {
    const el = await mount(v1());
    expect(el.uiString("NavigationControl.ZoomIn")).toBe("Acercar");
    expect(el.uiString("NavigationControl.ZoomOut")).toBe("Zoom out");
    expect(el.uiString("maplibre-yaml.FullPageMap.ResetView")).toBe("Reset view");
  });

  it("without a locale, everything stays English", async () => {
    const el = await mount({ ...v1(), config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/styles.json" } });
    latest().options.onError(new Error("bad"), false, { kind: "layer", layerId: "x" });
    expect(el.querySelector(".ml-map-notice strong")!.textContent).toBe("Part of this map couldn't load");
  });
});
