/**
 * @file classify `normalize:` / `multiply:` (ml-6x0.1): rates instead of
 * counts. The compiled expression divides behind a guard (a null, zero or
 * non-numeric denominator is no data — never Infinity or NaN), breaks are
 * computed on the rate, and the legend shows the rate.
 */

import { describe, it, expect, vi } from "vitest";
import { latest, createPropertyExpression, featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { toModel } from "../../src/model/to-model";
import { projectStyle } from "../../src/emitter/project";
import { bakeClassify } from "../../src/classify/lower";
import { fieldStats } from "../../src/classify/breaks";
import {
  resolveClassify,
  withData,
  compileClassify,
  classifyLegendEntries,
  classifyRecordOf,
  DEFAULT_NO_DATA_COLOR,
} from "../../src/classify/compile";
import type { ClassifyConfig } from "../../src/schemas/classify.schema";

const spec = latest as unknown as Record<string, Record<string, unknown>>;

function paintFor(layerType: string, property: string, expression: unknown, props: Record<string, unknown>) {
  const result = (createPropertyExpression as unknown as (e: unknown, key: string, s: unknown) => any)(
    expression,
    `layers[0].paint.${property}`,
    spec[`paint_${layerType}`]![property]
  );
  if (result.result !== "success") throw new Error(JSON.stringify(result.value));
  const value = result.value.evaluate({ zoom: 10 }, { type: 1, properties: props }) as unknown;
  if (value && typeof value === "object" && "r" in (value as object)) {
    const c = value as { r: number; g: number; b: number; a: number };
    const hex = (n: number) => Math.round((n / (c.a || 1)) * 255).toString(16).padStart(2, "0");
    return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
  }
  return value;
}

const filterFor = (expression: unknown, props: Record<string, unknown>) =>
  featureFilter(expression as never, "layers[0].filter").filter({ zoom: 10 } as never, { type: 1, properties: props } as never);

const rate: ClassifyConfig = {
  field: "cases",
  normalize: "population",
  multiply: 100000,
  breaks: [50, 200],
  colors: ["#111111", "#222222", "#333333"],
};

describe("normalize: the compiled rate", () => {
  it("classifies cases per 100,000 people", () => {
    const expr = compileClassify(resolveClassify(rate, "fill")).paint["fill-color"];
    expect(paintFor("fill", "fill-color", expr, { cases: 1, population: 10000 })).toBe("#111111"); // 10
    expect(paintFor("fill", "fill-color", expr, { cases: 5, population: 10000 })).toBe("#222222"); // 50 (edge → upper)
    expect(paintFor("fill", "fill-color", expr, { cases: 30, population: 10000 })).toBe("#333333"); // 300
    expect(paintFor("fill", "fill-color", expr, { cases: "15", population: "10000" })).toBe("#222222"); // CSV strings
  });

  it("a missing, zero or non-numeric denominator is no data — never Infinity or NaN", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const expr = compileClassify(resolveClassify(rate, "fill")).paint["fill-color"];
    for (const props of [
      { cases: 5, population: 0 },
      { cases: 5, population: "0" },
      { cases: 5, population: null },
      { cases: 5 },
      { cases: 5, population: "" },
      { cases: 5, population: "n/a" },
      { cases: null, population: 100 },
      { population: 100 },
      { cases: 0, population: 0 },
    ]) {
      expect(paintFor("fill", "fill-color", expr, props), JSON.stringify(props)).toBe(DEFAULT_NO_DATA_COLOR);
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("noData: hide filters on the same rule", () => {
    const compiled = compileClassify(resolveClassify({ ...rate, noData: "hide" }, "fill"));
    expect(filterFor(compiled.filter, { cases: 5, population: 100 })).toBe(true);
    expect(filterFor(compiled.filter, { cases: 5, population: 0 })).toBe(false);
    expect(filterFor(compiled.filter, { cases: 5 })).toBe(false);
    expect(paintFor("fill", "fill-color", compiled.paint["fill-color"], { cases: 30, population: 10000 })).toBe(
      "#333333"
    );
  });

  it("drives circle-radius from the rate too", () => {
    const record = resolveClassify({ ...rate, radius: [2, 6, 10] }, "circle");
    const paint = compileClassify(record).paint;
    expect(paintFor("circle", "circle-radius", paint["circle-radius"], { cases: 30, population: 10000 })).toBe(10);
    expect(paintFor("circle", "circle-radius", paint["circle-radius"], { cases: 30, population: 0 })).toBe(2);
  });

  it("without multiply: the plain ratio", () => {
    const expr = compileClassify(
      resolveClassify({ field: "a", normalize: "b", breaks: [0.5], colors: ["#000000", "#ffffff"] }, "fill")
    ).paint["fill-color"];
    expect(paintFor("fill", "fill-color", expr, { a: 1, b: 4 })).toBe("#000000");
    expect(paintFor("fill", "fill-color", expr, { a: 3, b: 4 })).toBe("#ffffff");
  });
});

const fc = (rows: Array<[unknown, unknown]>) => ({
  type: "FeatureCollection",
  features: rows.map(([cases, population]) => ({
    type: "Feature",
    properties: { cases, population },
    geometry: null,
  })),
});

describe("normalize: breaks and legend on the rate", () => {
  const data = fc([
    [1, 1000], // 100 per 100k
    [2, 1000], // 200
    [3, 1000], // 300
    [4, 1000], // 400
    [5, 0], // no data
    [null, 1000], // no data
  ]);

  it("reads the rate the expression reads", () => {
    const stats = fieldStats(data, "cases", "numeric", { normalize: "population", multiply: 100000 });
    expect(stats.values).toEqual([100, 200, 300, 400]);
    expect(stats.noData).toBe(2);
  });

  it("computes method: breaks on the rate", () => {
    const record = withData(
      resolveClassify({ field: "cases", normalize: "population", multiply: 100000, method: "equal", classes: 3 }, "fill"),
      data
    );
    expect(record.breaks).toEqual([200, 300]);
    expect(record.stats).toMatchObject({ min: 100, max: 400, noData: 2 });
  });

  it("labels the legend with the rate and names it", () => {
    const record = withData(
      resolveClassify({ field: "cases", normalize: "population", multiply: 100000, breaks: [250] }, "fill"),
      data
    );
    const labels = classifyLegendEntries(record).map((e) => e.label);
    expect(labels).toEqual(["cases per 100,000 population", "100–250", "250–400", "No data"]);
  });
});

describe("normalize: validation", () => {
  const doc = (classify: string) => `type: map
id: m
config: { center: [0, 0], zoom: 2 }
sources:
  t: { type: geojson, url: /t.geojson }
layers:
  - id: a
    type: fill
    source: t
    classify: ${classify}
`;

  it("accepts normalize with breaks and with method", () => {
    expect(YAMLParser.safeParseMapBlock(doc("{ field: cases, normalize: pop, multiply: 100000, breaks: [1] }")).errors).toEqual([]);
    expect(YAMLParser.safeParseMapBlock(doc("{ field: cases, normalize: pop, method: jenks }")).errors).toEqual([]);
  });

  it("refuses normalize on categories", () => {
    const r = YAMLParser.safeParseMapBlock(doc("{ field: zone, normalize: pop, categories: [a, b] }"));
    expect(r.success).toBe(false);
    expect(r.errors[0]!.path).toBe("layers.0.classify.normalize");
    expect(r.errors[0]!.message).toContain("categories");
  });

  it("refuses multiply without normalize, and a non-positive multiply", () => {
    const a = YAMLParser.safeParseMapBlock(doc("{ field: cases, multiply: 1000, breaks: [1] }"));
    expect(a.errors[0]!.path).toBe("layers.0.classify.multiply");
    expect(a.errors[0]!.message).toContain("normalize:");
    const b = YAMLParser.safeParseMapBlock(doc("{ field: cases, normalize: pop, multiply: 0, breaks: [1] }"));
    expect(b.errors[0]!.path).toBe("layers.0.classify.multiply");
  });

  it("refuses dividing a field by itself", () => {
    const r = YAMLParser.safeParseMapBlock(doc("{ field: cases, normalize: cases, breaks: [1] }"));
    expect(r.errors[0]!.path).toBe("layers.0.classify.normalize");
  });

  it("suggests normalize for the British spelling", () => {
    const r = YAMLParser.safeParseMapBlock(doc("{ field: cases, normalise: pop, breaks: [1] }"));
    expect(r.warnings.some((w) => w.message.includes('Did you mean "normalize"?'))).toBe(true);
  });
});

describe("normalize: export", () => {
  it("bakes method: breaks on the rate and records normalize in metadata", async () => {
    const parsed = YAMLParser.safeParseMapBlock(`type: map
id: m
config: { center: [0, 0], zoom: 2 }
sources:
  t: { type: geojson, url: https://example.com/t.geojson }
layers:
  - id: a
    type: fill
    source: t
    classify: { field: cases, normalize: population, multiply: 100000, method: quantile, classes: 2 }
`);
    expect(parsed.errors).toEqual([]);
    const baked = await bakeClassify(toModel(parsed.data as never), async () =>
      fc([
        [1, 1000],
        [2, 1000],
        [3, 1000],
        [4, 1000],
      ])
    );
    expect(baked.errors).toEqual([]);
    const record = classifyRecordOf(baked.model.style.layers[0]!.spec)!;
    expect(record).toMatchObject({ normalize: "population", multiply: 100000, breaks: [300] });
    const { warnings } = projectStyle(baked.model, "strict");
    expect(warnings.filter((w) => w.construct === "layer.classify")).toEqual([]);
  });
});
