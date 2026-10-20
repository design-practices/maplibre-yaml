/**
 * @file classify through the model and the emitter (ml-6x0): toModel lowers
 * v1 and v2 to the same plain MapLibre, inline data computes breaks at once,
 * fetched data stays pending until bakeClassify (what `mlym emit` runs), and
 * the emitted style is spec-valid with the record in layer metadata.
 */

import { describe, it, expect, vi } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { toModel } from "../../src/model/to-model";
import { denormalizeLayers } from "../../src/model";
import { projectStyle, EmitError } from "../../src/emitter/project";
import { bakeClassify } from "../../src/classify/lower";
import { CLASSIFY_METADATA_KEY, classifyRecordOf } from "../../src/classify/compile";
import { exportClasses } from "../../src/export/registrations";
import { LegendBuilder } from "../../src/renderer/legend-builder";
import { createStrings } from "../../src/i18n";

const FC = {
  type: "FeatureCollection",
  features: [3, 8, 12, 20, 25, 31, "40", null, 55].map((v, i) => ({
    type: "Feature",
    properties: { v },
    geometry: { type: "Point", coordinates: [i, 0] },
  })),
};

function v1(layers: string, sources = `  pts:\n    type: geojson\n    data: ${JSON.stringify(FC)}\n`) {
  const result = YAMLParser.safeParseMapBlock(`type: map
id: m
config:
  center: [0, 0]
  zoom: 2
sources:
${sources}layers:
${layers}`);
  if (!result.success) throw new Error(JSON.stringify(result.errors));
  return result.data as Record<string, unknown>;
}

describe("toModel lowering", () => {
  it("replaces classify with paint + metadata (explicit breaks, inline data → stats)", () => {
    const model = toModel(v1(`  - id: a
    type: circle
    source: pts
    classify: { field: v, breaks: [10, 30], palette: Blues }
`) as never);
    const spec = model.style.layers[0]!.spec;
    expect(spec["classify"]).toBeUndefined();
    expect((spec["paint"] as Record<string, unknown>)["circle-color"]).toBeInstanceOf(Array);
    const record = classifyRecordOf(spec)!;
    expect(record.breaks).toEqual([10, 30]);
    expect(record.stats).toEqual({ count: 9, noData: 1, min: 3, max: 55 });
  });

  it("computes method: breaks immediately when the data is inline", () => {
    const model = toModel(v1(`  - id: a
    type: circle
    source: pts
    classify: { field: v, method: quantile, classes: 4 }
`) as never);
    expect(classifyRecordOf(model.style.layers[0]!.spec)!.breaks).toEqual([12, 25, 40]);
  });

  it("leaves a fetched source pending", () => {
    const model = toModel(v1(`  - id: a
    type: fill
    source: remote
    classify: { field: v, method: jenks }
`, `  remote:\n    type: geojson\n    url: https://example.com/t.geojson\n`) as never);
    const record = classifyRecordOf(model.style.layers[0]!.spec)!;
    expect(record.method).toBe("jenks");
    expect(record.breaks).toBeUndefined();
  });

  it("v1 and v2 twins produce the same model", () => {
    const one = toModel(v1(`  - id: a
    type: circle
    source: pts
    label: Value
    classify: { field: v, breaks: [10], colors: [red, blue], noData: hide }
`) as never);
    const twoResult = YAMLParser.safeParseMapBlock(`version: 2
type: map
id: m
style:
  center: [0, 0]
  zoom: 2
  sources:
    pts:
      type: geojson
      data: ${JSON.stringify(FC)}
  layers:
    - id: a
      type: circle
      source: pts
      classify: { field: v, breaks: [10], colors: [red, blue], noData: hide }
      runtime: { label: Value }
`);
    expect(twoResult.errors).toEqual([]);
    const two = toModel(twoResult.data as never);
    expect(two.style.layers).toEqual(one.style.layers);
  });

  it("keeps the authored filter and ANDs the no-data guard onto it", () => {
    const model = toModel(v1(`  - id: a
    type: circle
    source: pts
    filter: [">", ["zoom"], 1]
    classify: { field: v, breaks: [10], noData: hide }
`) as never);
    const filter = model.style.layers[0]!.spec["filter"] as unknown[];
    expect(filter[0]).toBe("all");
    expect(filter[1]).toEqual([">", ["zoom"], 1]);
  });
});

describe("export", () => {
  it("is registered as exports", () => {
    expect(exportClasses.get("layer.classify")?.class).toBe("exports");
  });

  it("emits a spec-valid style with the compiled expression and the record", () => {
    const model = toModel(v1(`  - id: a
    type: circle
    source: pts
    classify: { field: v, method: equal, classes: 3, palette: viridis, radius: [3, 6, 9] }
  - id: b
    type: circle
    source: pts
    classify: { field: v, categories: ["3", "8"], other: hide }
`) as never);
    const { style, warnings } = projectStyle(model, "strict");
    expect(warnings).toEqual([]);
    expect(validateStyleMin(style as never)).toEqual([]);
    const layers = style["layers"] as Array<Record<string, unknown>>;
    const record = (layers[0]!["metadata"] as Record<string, unknown>)[CLASSIFY_METADATA_KEY] as {
      method: string;
      breaks: number[];
      palette: string;
    };
    expect(record).toMatchObject({ method: "equal", palette: "viridis" });
    expect(record.breaks[0]).toBeCloseTo(20.3333, 3);
    expect(record.breaks[1]).toBeCloseTo(37.6667, 3);
    expect(JSON.stringify(style)).not.toContain('"classify"');
  });

  it("projectStyle warns (lossy) when a pending layer was never baked", () => {
    const model = toModel(v1(`  - id: a
    type: fill
    source: remote
    classify: { field: v, method: quantile }
`, `  remote:\n    type: geojson\n    url: https://example.com/t.geojson\n`) as never);
    const { warnings } = projectStyle(model);
    expect(warnings).toContainEqual(
      expect.objectContaining({ path: "layers.a.classify", kind: "lossy", construct: "layer.classify" })
    );
    expect(() => projectStyle(model, "strict")).toThrow(EmitError);
  });

  it("bakeClassify loads each URL once and bakes the breaks", async () => {
    const model = toModel(v1(`  - id: a
    type: fill
    source: remote
    classify: { field: v, method: quantile, classes: 3 }
  - id: b
    type: line
    source: remote
    classify: { field: v, method: equal, classes: 2 }
`, `  remote:\n    type: geojson\n    url: https://example.com/t.geojson\n`) as never);
    const load = vi.fn(async () => FC);
    const baked = await bakeClassify(model, load);
    expect(baked.errors).toEqual([]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(classifyRecordOf(baked.model.style.layers[0]!.spec)!.breaks).toEqual([12, 31]);
    expect(classifyRecordOf(baked.model.style.layers[1]!.spec)!.breaks).toEqual([29]);
    const { style, warnings } = projectStyle(baked.model, "strict");
    expect(warnings.filter((w) => w.construct === "layer.classify")).toEqual([]);
    // The layers validate; the geojson `url:` source itself is ml-xzx.
    const layerErrors = validateStyleMin(style as never).filter((e) => /^layers/.test(e.message));
    expect(layerErrors).toEqual([]);
  });

  it("bakeClassify reports a URL it cannot load, naming the layer and the fix", async () => {
    const model = toModel(v1(`  - id: a
    type: fill
    source: remote
    classify: { field: v, method: quantile }
`, `  remote:\n    type: geojson\n    url: https://example.com/t.geojson\n`) as never);
    const baked = await bakeClassify(model, async () => {
      throw new Error("HTTP 404");
    });
    expect(baked.errors).toHaveLength(1);
    expect(baked.errors[0]!.message).toContain("https://example.com/t.geojson");
    expect(baked.errors[0]!.message).toContain("HTTP 404");
    expect(baked.errors[0]!.message).toContain("breaks:");
  });
});

describe("legend from the lowered layers", () => {
  it("draws a heading and real class edges", () => {
    const model = toModel(v1(`  - id: a
    type: fill
    source: pts
    label: Value
    classify: { field: v, breaks: [10, 30], colors: [red, green, blue] }
`) as never);
    const el = document.createElement("div");
    new LegendBuilder().build(el, denormalizeLayers(model) as never, { position: "top-left" } as never);
    const lines = [...el.querySelectorAll(".legend-group-heading, .legend-label")].map((n) => n.textContent);
    expect(lines).toEqual(["Value", "3–10", "10–30", "30–55", "No data"]);
  });

  it("routes No data / Other through the string table, and edges through the page's language", () => {
    const model = toModel(v1(`  - id: a
    type: fill
    source: pts
    label: Wert
    classify: { field: v, breaks: [10.5, 30], colors: [red, green, blue] }
`) as never);
    const el = document.createElement("div");
    const strings = createStrings({ "maplibre-yaml.Classify.NoData": "Keine Daten" });
    new LegendBuilder({ strings, locale: "de-DE" }).build(el, denormalizeLayers(model) as never, {} as never);
    const lines = [...el.querySelectorAll(".legend-group-heading, .legend-label")].map((n) => n.textContent);
    expect(lines).toEqual(["Wert", "3–10,5", "10,5–30", "30–55", "Keine Daten"]);
  });

  it("stays quiet (no 'no entries' warning) while breaks are pending", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = toModel(v1(`  - id: a
    type: fill
    source: remote
    classify: { field: v, method: quantile }
`, `  remote:\n    type: geojson\n    url: https://example.com/t.geojson\n`) as never);
    const el = document.createElement("div");
    new LegendBuilder().build(el, denormalizeLayers(model) as never, {} as never);
    expect(el.hidden).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
