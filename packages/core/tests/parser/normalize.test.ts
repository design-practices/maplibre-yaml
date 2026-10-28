/**
 * @file Value normalizations (KTD6, U2): the root `$schema` key, nested
 * `locale` tables and date values behave the same whether a document arrives
 * as YAML text, JSON text or a value.
 */

import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { parseDocumentText } from "../../src/parser/document-text";
import { normalizeDates } from "../../src/parser/normalize";
import { toModel } from "../../src/model/to-model";
import { projectStyle } from "../../src/emitter/project";

const STYLE = "https://example.com/style.json";

/** A v1 map whose `config:` ends with `extra` (indented two spaces). */
const map = (extra: string, head = "") => `${head}type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: ${STYLE}
${extra}
layers: []
`;

const locale = (r: { data?: unknown }) => (r.data as { config: { locale?: unknown } }).config.locale;

describe("nested locale tables flatten (AE3)", () => {
  it("YAML nested, YAML dotted and JSON dotted give the same locale", async () => {
    const nested = YAMLParser.safeParseMapBlock(map("  locale:\n    Popup:\n      Close: Fermer"));
    const dotted = YAMLParser.safeParseMapBlock(map('  locale:\n    "Popup.Close": Fermer'));
    const json = await parseDocumentText(
      JSON.stringify({
        type: "map",
        id: "m",
        config: { center: [0, 0], zoom: 2, mapStyle: STYLE, locale: { "Popup.Close": "Fermer" } },
        layers: [],
      }),
      { kind: "map" }
    );
    for (const r of [nested, dotted, json]) {
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([]);
      expect(locale(r)).toEqual({ "Popup.Close": "Fermer" });
    }
    // A value (React props, an Astro collection) flattens the same way.
    const value = YAMLParser.safeParseMapBlockValue({
      type: "map",
      id: "m",
      config: { center: [0, 0], zoom: 2, mapStyle: STYLE, locale: { Popup: { Close: "Fermer" } } },
      layers: [],
    });
    expect(locale(value)).toEqual({ "Popup.Close": "Fermer" });
  });

  it("a key written both dotted and nested fails, naming both, at the second", () => {
    const r = YAMLParser.safeParseMapBlock(
      map('  locale:\n    "Popup.Close": Fermer\n    Popup:\n      Close: Quitter')
    );
    expect(r.success).toBe(false);
    expect(r.errors).toEqual([
      {
        path: 'config.locale."Popup.Close"',
        code: "schema",
        message:
          'The locale key "Popup.Close" is written twice, as "Popup.Close" and as Popup.Close (nested). Keep one.',
        line: 10,
        column: 7,
      },
    ]);
  });

  it("flattens three levels, and keeps a quoted dotted key inside a table as written", () => {
    const r = YAMLParser.safeParseMapBlock(
      map('  locale:\n    Map:\n      Controls:\n        Zoom: Zoomer\n    Nav:\n      "Zoom.In": Plus\n    Title: Carte')
    );
    expect(r.errors).toEqual([]);
    expect(locale(r)).toEqual({ "Map.Controls.Zoom": "Zoomer", "Nav.Zoom.In": "Plus", Title: "Carte" });
  });

  it("an empty nested table warns", () => {
    const r = YAMLParser.safeParseMapBlock(map("  locale:\n    Popup: {}\n    Close: Fermer"));
    expect(r.success).toBe(true);
    expect(r.warnings).toEqual([
      {
        path: 'config.locale."Popup"',
        message: 'The locale table "Popup" is empty, so it translates nothing.',
        line: 8,
        column: 5,
      },
    ]);
    expect(locale(r)).toEqual({ Close: "Fermer" });
  });

  it("a nested number leaf errors at its flattened path, the segment quoted", () => {
    const r = YAMLParser.safeParseMapBlock(map("  locale:\n    Popup:\n      Close: 5"));
    expect(r.success).toBe(false);
    expect(r.errors).toEqual([
      {
        path: 'config.locale."Popup.Close"',
        code: "schema",
        message: 'The locale entry "Popup.Close" must be a string, got number.',
        line: 9,
        column: 14,
      },
    ]);
  });

  it("leaves a flat table's errors exactly as before", () => {
    const r = YAMLParser.safeParseMapBlock(map("  locale:\n    Close: 5"));
    expect(r.errors.map((e) => [e.path, e.message, e.line, e.column])).toEqual([
      ["config.locale.Close", "Expected string, got number", 8, 12],
    ]);
  });

  it("a misspelt maplibre-yaml key in a nested table points at the authored key", () => {
    const r = YAMLParser.safeParseMapBlock(map("  locale:\n    maplibre-yaml:\n      Legend:\n        Titel: Légende"));
    expect(r.warnings.map((w) => [w.path, w.suggestion, w.line, w.column])).toEqual([
      ["config.locale.maplibre-yaml.Legend.Titel", "maplibre-yaml.Legend.Title", 10, 9],
    ]);
  });

  it("v2 runtime.map.locale flattens the same way", () => {
    const r = YAMLParser.safeParseMapBlock(`version: 2
type: map
id: m
style:
  center: [0, 0]
  zoom: 2
  basemap: ${STYLE}
  sources: {}
  layers: []
runtime:
  map:
    locale:
      Popup:
        Close: Fermer
      maplibre-yaml:
        Legend:
          Titel: Légende
`);
    expect(r.errors).toEqual([]);
    expect((r.data as any).runtime.map.locale).toEqual({
      "Popup.Close": "Fermer",
      "maplibre-yaml.Legend.Titel": "Légende",
    });
    expect(r.warnings.map((w) => [w.path, w.line, w.column])).toEqual([
      ["runtime.map.locale.maplibre-yaml.Legend.Titel", 17, 11],
    ]);
  });

  it("the throwing entry points flatten too, and throw a collision", () => {
    expect(YAMLParser.parseMapBlock(map("  locale:\n    Popup:\n      Close: Fermer")).config.locale).toEqual({
      "Popup.Close": "Fermer",
    });
    expect(() =>
      YAMLParser.parseMapBlock(map('  locale:\n    "Popup.Close": Fermer\n    Popup:\n      Close: Quitter'))
    ).toThrow('config.locale."Popup.Close": The locale key "Popup.Close" is written twice');
  });

  it("__proto__ and constructor tables touch no prototype and raise no false collision", () => {
    const r = YAMLParser.safeParseMapBlock(
      map("  locale:\n    __proto__:\n      Close: Fermer\n    constructor:\n      name: Nom\n    Open: Ouvrir")
    );
    expect(r.errors).toEqual([]);
    expect(Object.prototype).not.toHaveProperty("Close");
    expect(({} as Record<string, unknown>)["Close"]).toBeUndefined();
    expect(locale(r)).toEqual({ "__proto__.Close": "Fermer", "constructor.name": "Nom", Open: "Ouvrir" });

    // `__proto__` as a flattened key is an own key, not a collision.
    const own = YAMLParser.safeParseMapBlockValue({
      type: "map",
      id: "m",
      config: {
        center: [0, 0],
        zoom: 2,
        mapStyle: STYLE,
        locale: JSON.parse('{"__proto__": "x", "toString": "y", "A": {"B": "z"}}'),
      },
      layers: [],
    });
    expect(own.errors).toEqual([]);
    expect(Object.getOwnPropertyNames(locale(own))).toEqual(expect.arrayContaining(["toString", "A.B"]));
    expect(Object.getPrototypeOf(locale(own))).toBe(Object.prototype);
  });
});

describe("root $schema", () => {
  const HEAD = "$schema: https://docs.maplibre-yaml.org/schema/latest/map.schema.json\n";

  it("a root $schema in YAML or JSON gives no warning and never reaches the document or the style", async () => {
    const yaml = YAMLParser.safeParseMapBlock(map("", HEAD));
    const json = await parseDocumentText(
      JSON.stringify({ $schema: "./map.schema.json", type: "map", id: "m", config: { center: [0, 0], zoom: 2, mapStyle: STYLE }, layers: [] }),
      { kind: "map" }
    );
    for (const r of [yaml, json]) {
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([]);
      expect(r.data).not.toHaveProperty("$schema");
      const { style } = projectStyle(toModel(r.data as never), "strict");
      expect(JSON.stringify(style)).not.toContain("$schema");
    }
  });

  it("is stripped from stories and root documents too", () => {
    const story = YAMLParser.safeParseScrollytellingBlock(`${HEAD}type: scrollytelling
id: s
config: { center: [0, 0], zoom: 1, mapStyle: "${STYLE}" }
chapters: [{ id: a, title: A, center: [0, 0], zoom: 1 }]
`);
    expect(story.errors).toEqual([]);
    expect(story.warnings.filter((w) => w.path === "$schema")).toEqual([]);
    const root = YAMLParser.safeParse(`${HEAD}pages:\n  - path: /\n    title: Home\n    blocks: []\n`);
    expect(root.errors).toEqual([]);
    expect(root.warnings.filter((w) => w.path === "$schema")).toEqual([]);
  });

  it("a $schema nested in a layer still warns", () => {
    const r = YAMLParser.safeParseMapBlock(
      map("", HEAD).replace(
        "layers: []",
        "sources:\n  s: { type: geojson, data: { type: FeatureCollection, features: [] } }\nlayers:\n  - id: l\n    type: circle\n    source: s\n    $schema: x"
      )
    );
    expect(r.warnings.map((w) => w.path)).toContain("layers.0.$schema");
  });
});

describe("date values", () => {
  /** A smol-toml style local date: a Date whose ISO text is the date alone. */
  class LocalDate extends Date {
    override toISOString() {
      return "2024-01-02";
    }
  }

  it("a Date in a feature property becomes ISO 8601 text, a date-like keeps its own text", () => {
    const r = YAMLParser.safeParseMapBlockValue({
      type: "map",
      id: "m",
      config: { center: [0, 0], zoom: 2, mapStyle: STYLE },
      sources: {
        s: {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [0, 0] },
                properties: { at: new Date("2024-01-02T00:00:00Z"), local: new LocalDate(0), list: [new Date(0)] },
              },
            ],
          },
        },
      },
      layers: [],
    });
    expect(r.errors).toEqual([]);
    const props = (r.data as any).sources.s.data.features[0].properties;
    expect(props).toEqual({ at: "2024-01-02T00:00:00.000Z", local: "2024-01-02", list: ["1970-01-01T00:00:00.000Z"] });
  });

  it("returns the same object when there is no date in it", () => {
    const input = { a: [{ b: 1 }, "x"], c: { d: null, e: [] }, ["__proto__"]: { f: 1 } };
    expect(normalizeDates(input)).toBe(input);
    const list = [1, { a: [2] }];
    expect(normalizeDates(list)).toBe(list);
  });

  it("copies only the path to a date; untouched siblings keep their identity", () => {
    const sibling = { keep: [1, 2] };
    const other = [{ x: 1 }];
    const input = { a: { b: [sibling, { when: new Date(0) }], c: other }, d: sibling };
    const out = normalizeDates(input) as any;
    expect(out).not.toBe(input);
    expect(out.a).not.toBe(input.a);
    expect(out.a.b).not.toBe(input.a.b);
    expect(out.a.b[1]).toEqual({ when: "1970-01-01T00:00:00.000Z" });
    expect(out.a.b[0]).toBe(sibling);
    expect(out.a.c).toBe(other);
    expect(out.d).toBe(sibling);
    expect(input.a.b[1]!.when).toBeInstanceOf(Date);
  });

  it("keeps a __proto__ key as data in a copied object", () => {
    const input = JSON.parse('{"__proto__": {"polluted": true}, "when": 0}');
    input.when = new Date(0);
    const out = normalizeDates(input) as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(out, "__proto__")?.value).toEqual({ polluted: true });
    expect(({} as any).polluted).toBeUndefined();
  });

  it("walks arrays and objects into a copy, leaving the input alone", () => {
    const input = { a: [{ d: new Date(0) }], b: { toJSON: () => "text" }, c: 1 };
    expect(normalizeDates(input)).toEqual({ a: [{ d: "1970-01-01T00:00:00.000Z" }], b: "text", c: 1 });
    expect(input.a[0]!.d).toBeInstanceOf(Date);
  });
});

describe("normalizeDocumentValue (exported for values parsed elsewhere)", () => {
  it("returns a normalized copy and leaves the input alone", async () => {
    const { normalizeDocumentValue } = await import("../../src/index");
    const input = {
      $schema: "https://docs.maplibre-yaml.org/schema/latest/map.schema.json",
      type: "map",
      config: { locale: { Popup: { Close: "Fermer" } } },
      layers: [{ when: new Date(0) }],
    };
    const { value, issues, warnings } = normalizeDocumentValue(input);
    expect(issues).toEqual([]);
    expect(warnings).toEqual([]);
    expect(value).toEqual({
      type: "map",
      config: { locale: { "Popup.Close": "Fermer" } },
      layers: [{ when: "1970-01-01T00:00:00.000Z" }],
    });
    expect(input.config.locale.Popup.Close).toBe("Fermer");
    expect(input.$schema).toBeDefined();
  });

  it("leaves an input with no dates alone too (no root $schema dropped, no locale flattened in it)", async () => {
    const { normalizeDocumentValue } = await import("../../src/index");
    const input = {
      $schema: "https://docs.maplibre-yaml.org/schema/latest/map.schema.json",
      type: "map",
      config: { locale: { Popup: { Close: "Fermer" } } },
      runtime: { map: { locale: { Popup: { Close: "Fermer" } } } },
    };
    const before = structuredClone(input);
    const { value } = normalizeDocumentValue(input);
    expect(input).toEqual(before);
    expect(value).toEqual({
      type: "map",
      config: { locale: { "Popup.Close": "Fermer" } },
      runtime: { map: { locale: { "Popup.Close": "Fermer" } } },
    });
  });

  it("reports a collision with its path as segments", async () => {
    const { normalizeDocumentValue } = await import("../../src/index");
    const { issues } = normalizeDocumentValue({
      config: { locale: { "Popup.Close": "a", Popup: { Close: "b" } } },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(["config", "locale", "Popup.Close"]);
    expect(issues[0]!.message).toContain("written twice");
  });
});
