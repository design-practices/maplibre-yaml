/**
 * The one UI string table (0.9): English defaults, overridden per document
 * through the same `locale:` map MapLibre reads, under namespaced keys.
 */
import { describe, it, expect, vi } from "vitest";

// The package root pulls in the renderer; maplibre-gl 4's UMD bundle needs
// URL.createObjectURL at import, which jsdom lacks (the CI matrix runs 4).
vi.mock("maplibre-gl", () => ({ default: {}, Map: vi.fn() }));
import {
  DEFAULT_STRINGS,
  MAPLIBRE_STRINGS,
  STRINGS_PREFIX,
  createStrings,
  defaultStrings,
  documentLocale,
  elementLanguage,
  fillPlaceholders,
} from "../../src/i18n";
import * as core from "../../src";

describe("the string table", () => {
  it("every library key is namespaced, so it can't collide with MapLibre's", () => {
    for (const key of Object.keys(DEFAULT_STRINGS)) {
      expect(key.startsWith(STRINGS_PREFIX), key).toBe(true);
    }
    for (const key of Object.keys(MAPLIBRE_STRINGS)) {
      expect(key.startsWith(STRINGS_PREFIX), key).toBe(false);
    }
  });

  it("English by default", () => {
    expect(defaultStrings("maplibre-yaml.Legend.Title")).toBe("Legend");
    expect(defaultStrings("maplibre-yaml.Notice.Title")).toBe("Part of this map couldn't load");
    expect(defaultStrings("Map.Title")).toBe("Map");
    expect(defaultStrings("NavigationControl.ZoomIn")).toBe("Zoom in");
  });

  it("a locale table overrides library keys and the MapLibre keys the library reads", () => {
    const t = createStrings({
      "maplibre-yaml.Legend.Title": "Leyenda",
      "NavigationControl.ZoomIn": "Acercar",
      "Map.Title": "Mapa",
    });
    expect(t("maplibre-yaml.Legend.Title")).toBe("Leyenda");
    expect(t("NavigationControl.ZoomIn")).toBe("Acercar");
    expect(t("Map.Title")).toBe("Mapa");
    // Untranslated keys fall back to English.
    expect(t("maplibre-yaml.Notice.Dismiss")).toBe("Dismiss this notice");
  });

  it("fills {placeholders}, in translations too", () => {
    expect(defaultStrings("maplibre-yaml.Notice.More", { count: 3 })).toBe(
      "…and 3 more (see the browser console)."
    );
    const t = createStrings({ "maplibre-yaml.Story.GoToChapter": "Capítulo {number}: {title}" });
    expect(t("maplibre-yaml.Story.GoToChapter", { number: 2, title: "El puente" })).toBe(
      "Capítulo 2: El puente"
    );
    expect(fillPlaceholders("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });

  it("ignores empty or non-string entries and non-object tables", () => {
    const t = createStrings({ "maplibre-yaml.Legend.Title": "  ", "maplibre-yaml.Notice.Title": 4 });
    expect(t("maplibre-yaml.Legend.Title")).toBe("Legend");
    expect(t("maplibre-yaml.Notice.Title")).toBe("Part of this map couldn't load");
    expect(createStrings("es")("maplibre-yaml.Legend.Title")).toBe("Legend");
    expect(createStrings(null)("maplibre-yaml.Legend.Title")).toBe("Legend");
  });

  it("documentLocale reads v1 config.locale and v2 runtime.map.locale", () => {
    const table = { "maplibre-yaml.Legend.Title": "Leyenda" };
    expect(documentLocale({ type: "map", config: { locale: table } })).toBe(table);
    expect(documentLocale({ version: 2, type: "map", runtime: { map: { locale: table } } })).toBe(table);
    expect(documentLocale({ type: "scrollytelling", config: { locale: table } })).toBe(table);
    expect(documentLocale({ type: "map", config: {} })).toBeUndefined();
    expect(documentLocale(null)).toBeUndefined();
  });

  it("elementLanguage is the nearest lang attribute", () => {
    const outer = document.createElement("section");
    outer.setAttribute("lang", "de-DE");
    const inner = document.createElement("div");
    outer.appendChild(inner);
    expect(elementLanguage(inner)).toBe("de-DE");
    inner.setAttribute("lang", "fr");
    expect(elementLanguage(inner)).toBe("fr");
    inner.setAttribute("lang", "");
    expect(elementLanguage(inner)).toBeUndefined();
    expect(elementLanguage(null)).toBeUndefined();
  });

  it("is public API from the package root", () => {
    expect(core.createStrings).toBe(createStrings);
    expect(core.DEFAULT_STRINGS).toBe(DEFAULT_STRINGS);
    expect(typeof core.formatNumber).toBe("function");
  });
});
