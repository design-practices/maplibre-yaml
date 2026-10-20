/**
 * @file classify → expressions (ml-340/ml-kar/ml-n2e): the compiled shape
 * (snapshots), what MapLibre's own evaluator paints for real feature values
 * — including the no-data cases that paint black without the guard — and
 * the legend lines.
 */

import { describe, it, expect, vi } from "vitest";
import { latest, createPropertyExpression, featureFilter } from "@maplibre/maplibre-gl-style-spec";
import {
  resolveClassify,
  withData,
  compileClassify,
  classifyLegendEntries,
  classLabels,
  applyClassifyToSpec,
  CLASSIFY_COLOR_PROPERTIES,
  CLASSIFY_METADATA_KEY,
  DEFAULT_NO_DATA_COLOR,
} from "../../src/classify/compile";
import type { ClassifyConfig } from "../../src/schemas/classify.schema";

const spec = latest as unknown as Record<string, Record<string, unknown>>;

/** Evaluate a paint expression for one feature, as MapLibre would. */
function paintFor(layerType: string, property: string, expression: unknown, props: Record<string, unknown>) {
  const result = (createPropertyExpression as unknown as (e: unknown, key: string, s: unknown) => any)(
    expression,
    `layers[0].paint.${property}`,
    spec[`paint_${layerType}`]![property]
  );
  if (result.result !== "success") throw new Error(JSON.stringify(result.value));
  const value = result.value.evaluate({ zoom: 10 } as never, { type: 1, properties: props } as never) as unknown;
  if (value && typeof value === "object" && "r" in (value as object)) {
    const c = value as { r: number; g: number; b: number; a: number };
    const hex = (n: number) => Math.round((n / (c.a || 1)) * 255).toString(16).padStart(2, "0");
    return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
  }
  return value;
}

function filterFor(expression: unknown, props: Record<string, unknown>): boolean {
  return featureFilter(expression as never, "layers[0].filter").filter(
    { zoom: 10 } as never,
    { type: 1, properties: props } as never
  );
}

const numeric: ClassifyConfig = {
  field: "v",
  breaks: [10, 25],
  colors: ["#111111", "#222222", "#333333"],
};

describe("numeric classes (step)", () => {
  it("compiles to a guarded step expression", () => {
    const compiled = compileClassify(resolveClassify(numeric, "fill"));
    expect(compiled.filter).toBeUndefined();
    expect(compiled.paint).toMatchInlineSnapshot(`
      {
        "fill-color": [
          "let",
          "value",
          [
            "get",
            "v",
          ],
          [
            "case",
            [
              "any",
              [
                "all",
                [
                  "==",
                  [
                    "typeof",
                    [
                      "var",
                      "value",
                    ],
                  ],
                  "number",
                ],
                [
                  "==",
                  [
                    "var",
                    "value",
                  ],
                  [
                    "var",
                    "value",
                  ],
                ],
              ],
              [
                "all",
                [
                  "==",
                  [
                    "typeof",
                    [
                      "var",
                      "value",
                    ],
                  ],
                  "string",
                ],
                [
                  "!=",
                  [
                    "var",
                    "value",
                  ],
                  "",
                ],
                [
                  "==",
                  [
                    "to-number",
                    [
                      "var",
                      "value",
                    ],
                    0,
                  ],
                  [
                    "to-number",
                    [
                      "var",
                      "value",
                    ],
                    1,
                  ],
                ],
              ],
            ],
            [
              "step",
              [
                "to-number",
                [
                  "var",
                  "value",
                ],
              ],
              "#111111",
              10,
              "#222222",
              25,
              "#333333",
            ],
            "#cccccc",
          ],
        ],
      }
    `);
  });

  it("paints each class with step's lower-inclusive edges", () => {
    const expr = compileClassify(resolveClassify(numeric, "fill")).paint["fill-color"];
    expect(paintFor("fill", "fill-color", expr, { v: 5 })).toBe("#111111");
    expect(paintFor("fill", "fill-color", expr, { v: 10 })).toBe("#222222"); // equal → upper class
    expect(paintFor("fill", "fill-color", expr, { v: 24.9 })).toBe("#222222");
    expect(paintFor("fill", "fill-color", expr, { v: 25 })).toBe("#333333");
    expect(paintFor("fill", "fill-color", expr, { v: -3 })).toBe("#111111");
  });

  it("no data paints grey, never MapLibre's black fallback (ml-kar)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const expr = compileClassify(resolveClassify(numeric, "fill")).paint["fill-color"];
    for (const props of [{}, { v: null }, { v: "" }, { v: "abc" }, { v: NaN }, { v: true }, { v: [1] }]) {
      expect(paintFor("fill", "fill-color", expr, props)).toBe(DEFAULT_NO_DATA_COLOR);
    }
    // MapLibre logs an evaluation error (and paints black) when an expression
    // fails: the guard means it never does.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("reads numeric strings (CSV-derived GeoJSON) as numbers", () => {
    const expr = compileClassify(resolveClassify(numeric, "fill")).paint["fill-color"];
    expect(paintFor("fill", "fill-color", expr, { v: "15" })).toBe("#222222");
    expect(paintFor("fill", "fill-color", expr, { v: "30.5" })).toBe("#333333");
  });

  it("without the guard, the same values paint black — the bug the guard fixes", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bare = ["step", ["get", "v"], "#111111", 10, "#222222", 25, "#333333"];
    expect(paintFor("fill", "fill-color", bare, { v: null })).toBe("#000000");
    expect(paintFor("fill", "fill-color", bare, { v: "15" })).toBe("#000000");
    warn.mockRestore();
  });

  it("noData: hide filters the features out and drops the guard from paint", () => {
    const compiled = compileClassify(resolveClassify({ ...numeric, noData: "hide" }, "fill"));
    expect(compiled.paint["fill-color"]).toEqual([
      "step",
      ["to-number", ["get", "v"]],
      "#111111",
      10,
      "#222222",
      25,
      "#333333",
    ]);
    expect(filterFor(compiled.filter, { v: 3 })).toBe(true);
    expect(filterFor(compiled.filter, { v: "3" })).toBe(true);
    for (const props of [{}, { v: null }, { v: "" }, { v: "x" }]) {
      expect(filterFor(compiled.filter, props)).toBe(false);
    }
  });

  it("a custom noData colour and a named palette resolve at compile time", () => {
    const record = resolveClassify({ field: "v", breaks: [1, 2], palette: "blues", noData: "pink" }, "circle");
    expect(record.property).toBe("circle-color");
    expect(record.palette).toBe("Blues");
    expect(record.colors).toEqual(["#deebf7", "#9ecae1", "#3182bd"]);
    const expr = compileClassify(record).paint["circle-color"];
    expect(paintFor("circle", "circle-color", expr, {})).toBe("#ffc0cb");
  });

  it("reverse flips the palette; one break makes two classes", () => {
    const record = resolveClassify({ field: "v", breaks: [5], palette: "Reds", reverse: true }, "fill");
    expect(record.colors).toHaveLength(2);
    const forward = resolveClassify({ field: "v", breaks: [5], palette: "Reds" }, "fill");
    expect(record.colors).toEqual([...forward.colors!].reverse());
  });

  it("defaults to a CVD-safe sequential palette (viridis past 9 classes)", () => {
    expect(resolveClassify({ field: "v", breaks: [1, 2, 3, 4] }, "fill").palette).toBe("YlGnBu");
    const many = resolveClassify({ field: "v", method: "quantile", classes: 11 }, "fill");
    expect(many.palette).toBe("viridis");
    expect(many.colors).toHaveLength(11);
  });

  it("drives any colour property the layer type has", () => {
    const record = resolveClassify({ ...numeric, property: "circle-stroke-color" }, "circle");
    expect(Object.keys(compileClassify(record).paint)).toEqual(["circle-stroke-color"]);
  });
});

describe("graduated symbols (radius)", () => {
  it("compiles circle-radius beside the colour, sharing the breaks", () => {
    const record = resolveClassify(
      { field: "pop", breaks: [1000, 10000], palette: "YlOrRd", radius: [4, 8, 14] },
      "circle"
    );
    const paint = compileClassify(record).paint;
    expect(paintFor("circle", "circle-radius", paint["circle-radius"], { pop: 500 })).toBe(4);
    expect(paintFor("circle", "circle-radius", paint["circle-radius"], { pop: "20000" })).toBe(14);
    expect(paintFor("circle", "circle-radius", paint["circle-radius"], {})).toBe(4);
    expect(paintFor("circle", "circle-color", paint["circle-color"], { pop: 5000 })).toBe(record.colors![1]);
  });

  it("radius alone leaves the colour to the author and hides no-data features", () => {
    const record = resolveClassify({ field: "pop", breaks: [10], radius: [3, 9] }, "circle");
    expect(record.property).toBeUndefined();
    expect(record.noData).toBe("hide");
    const compiled = compileClassify(record);
    expect(Object.keys(compiled.paint)).toEqual(["circle-radius"]);
    expect(filterFor(compiled.filter, {})).toBe(false);
  });
});

describe("categorical classes (match)", () => {
  const config: ClassifyConfig = {
    field: "zone",
    categories: { residential: "#aa0000", commercial: "#00aa00", "1": "#0000aa" },
    other: "#999999",
  };

  it("compiles to a match on to-string, behind a no-data case", () => {
    // (A YAML map's integer-like keys come first — JavaScript object order.)
    expect(compileClassify(resolveClassify(config, "fill")).paint["fill-color"]).toEqual([
      "case",
      ["==", ["to-string", ["get", "zone"]], ""],
      DEFAULT_NO_DATA_COLOR,
      [
        "match",
        ["to-string", ["get", "zone"]],
        "1",
        "#0000aa",
        "residential",
        "#aa0000",
        "commercial",
        "#00aa00",
        "#999999",
      ],
    ]);
  });

  it("paints listed values, numeric codes, other and no data", () => {
    const expr = compileClassify(resolveClassify(config, "fill")).paint["fill-color"];
    expect(paintFor("fill", "fill-color", expr, { zone: "residential" })).toBe("#aa0000");
    expect(paintFor("fill", "fill-color", expr, { zone: 1 })).toBe("#0000aa");
    expect(paintFor("fill", "fill-color", expr, { zone: "1" })).toBe("#0000aa");
    expect(paintFor("fill", "fill-color", expr, { zone: "industrial" })).toBe("#999999");
    expect(paintFor("fill", "fill-color", expr, {})).toBe(DEFAULT_NO_DATA_COLOR);
    expect(paintFor("fill", "fill-color", expr, { zone: null })).toBe(DEFAULT_NO_DATA_COLOR);
    expect(paintFor("fill", "fill-color", expr, { zone: "" })).toBe(DEFAULT_NO_DATA_COLOR);
  });

  it("a list of values takes the palette (CVD-safe okabe-ito by default)", () => {
    const record = resolveClassify({ field: "k", categories: ["a", "b", 3] }, "circle");
    expect(record.palette).toBe("okabe-ito");
    expect(record.categories).toEqual([
      { value: "a", color: "#e69f00" },
      { value: "b", color: "#56b4e9" },
      { value: "3", color: "#009e73" },
    ]);
  });

  it("other: hide and noData: hide become filters", () => {
    const hideOther = compileClassify(resolveClassify({ ...config, other: "hide" }, "fill"));
    expect(filterFor(hideOther.filter, { zone: "residential" })).toBe(true);
    expect(filterFor(hideOther.filter, { zone: "industrial" })).toBe(false);
    expect(filterFor(hideOther.filter, {})).toBe(false);
    const hideNoData = compileClassify(resolveClassify({ ...config, noData: "hide" }, "fill"));
    expect(filterFor(hideNoData.filter, { zone: "industrial" })).toBe(true);
    expect(filterFor(hideNoData.filter, { zone: null })).toBe(false);
  });
});

describe("computed breaks (method:) and data", () => {
  const fc = {
    type: "FeatureCollection",
    features: [1, 2, 3, 4, 5, 6, 7, 8, 9, "10", null].map((v) => ({
      type: "Feature",
      properties: { v },
      geometry: null,
    })),
  };

  it("is pending until it sees the data, then carries real breaks and stats", () => {
    const template = resolveClassify({ field: "v", method: "equal", classes: 3, palette: "Greens" }, "fill");
    expect(template.breaks).toBeUndefined();
    expect(compileClassify(template).paint["fill-color"]).toEqual(["to-color", DEFAULT_NO_DATA_COLOR]);
    const record = withData(template, fc);
    expect(record.breaks).toEqual([4, 7]);
    expect(record.stats).toEqual({ count: 11, noData: 1, min: 1, max: 10 });
    expect(record.colors).toHaveLength(3);
  });

  it("draws fewer classes, with the palette's own smaller scheme, when ties collapse them", () => {
    const ties = {
      type: "FeatureCollection",
      features: [0, 0, 0, 0, 0, 0, 0, 5, 9, 10].map((v) => ({ type: "Feature", properties: { v }, geometry: null })),
    };
    const template = resolveClassify({ field: "v", method: "quantile", classes: 5, palette: "Blues" }, "fill");
    const record = withData(template, ties);
    expect(record.breaks!.length + 1).toBeLessThan(5);
    expect(record.colors).toHaveLength(record.breaks!.length + 1);
  });

  it("writes the record into the layer's metadata, with the compiled paint and filter", () => {
    const record = withData(resolveClassify({ field: "v", breaks: [5], noData: "hide" }, "fill"), fc);
    const out = applyClassifyToSpec(
      { id: "a", type: "fill", source: "s", classify: {}, filter: ["==", ["get", "k"], 1], paint: { "fill-opacity": 0.5 } },
      record
    );
    expect(out["classify"]).toBeUndefined();
    expect(out["paint"]).toMatchObject({ "fill-opacity": 0.5 });
    expect((out["paint"] as Record<string, unknown>)["fill-color"]).toBeDefined();
    expect(out["filter"]).toEqual(["all", ["==", ["get", "k"], 1], compileClassify(record).filter]);
    expect((out["metadata"] as Record<string, unknown>)[CLASSIFY_METADATA_KEY]).toEqual(record);
  });
});

describe("legend lines (ml-n2e)", () => {
  it("labels classes with step's edges", () => {
    expect(classLabels([10, 25])).toEqual(["< 10", "10–25", "≥ 25"]);
    expect(classLabels([10, 25], { min: 0, max: 98 })).toEqual(["0–10", "10–25", "25–98"]);
    expect(classLabels([0.2, 0.4])).toEqual(["< 0.2", "0.2–0.4", "≥ 0.4"]);
    expect(classLabels([-5, 5])).toEqual(["< -5", "-5 – 5", "≥ 5"]);
    expect(classLabels([1000, 25000])).toEqual(["< 1,000", "1,000–25,000", "≥ 25,000"]);
    // jenks can isolate the maximum: its class is that one value.
    expect(classLabels([10, 50], { min: 1, max: 50 })).toEqual(["1–10", "10–50", "50"]);
  });

  it("formats with MapLibre number-format option names", () => {
    expect(classLabels([1000, 2000], undefined, { locale: "en-US", currency: "USD", "max-fraction-digits": 0 })).toEqual([
      "< $1,000",
      "$1,000–$2,000",
      "≥ $2,000",
    ]);
    // Intl puts a no-break space before the unit.
    expect(classLabels([10, 20], undefined, { locale: "de-DE", unit: "percent" })[1]!.replace(/\s/g, " ")).toBe(
      "10 %–20 %"
    );
  });

  it("generates a heading, the classes and a no-data line", () => {
    const record = resolveClassify({ field: "v", breaks: [10], colors: ["#111111", "#222222"] }, "fill");
    expect(classifyLegendEntries(record, { title: "Value", layerType: "fill" })).toEqual([
      { heading: true, label: "Value", color: "transparent" },
      { label: "< 10", color: "#111111", shape: "square" },
      { label: "≥ 10", color: "#222222", shape: "square" },
      { label: "No data", color: DEFAULT_NO_DATA_COLOR, shape: "square" },
    ]);
  });

  it("drops No data / Other when the data shows none, and omits them when hidden", () => {
    const fc = {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: { k: "a" }, geometry: null }],
    };
    const record = withData(resolveClassify({ field: "k", categories: { a: "red", b: "blue" } }, "fill"), fc);
    const labels = classifyLegendEntries(record).map((e) => e.label);
    expect(labels).toEqual(["k", "a", "b"]);
    const hidden = resolveClassify({ field: "k", categories: { a: "red" }, other: "hide", noData: "hide" }, "fill");
    expect(classifyLegendEntries(hidden).map((e) => e.label)).toEqual(["k", "a"]);
  });

  it("sizes graduated-circle swatches by class", () => {
    const record = resolveClassify({ field: "p", breaks: [10], radius: [3, 9], palette: "Reds" }, "circle");
    const entries = classifyLegendEntries(record, { layerType: "circle" });
    expect(entries[1]).toMatchObject({ shape: "circle", size: 6 });
    expect(entries[2]).toMatchObject({ shape: "circle", size: 18 });
  });

  it("shows nothing while computed breaks wait for data", () => {
    expect(classifyLegendEntries(resolveClassify({ field: "v", method: "jenks" }, "fill"))).toEqual([]);
  });
});

describe("colour properties", () => {
  it("lists only data-driven colour paint properties of the style spec", () => {
    for (const [type, properties] of Object.entries(CLASSIFY_COLOR_PROPERTIES)) {
      for (const property of properties) {
        const def = spec[`paint_${type}`]![property] as { type: string; "property-type": string };
        expect(def, `${type}.${property}`).toBeDefined();
        expect(def.type).toBe("color");
        expect(def["property-type"]).toBe("data-driven");
      }
    }
  });
});
