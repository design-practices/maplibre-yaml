/**
 * @file classify: validation (ml-340/ml-kar) — positioned errors, did-you-mean
 * for method and palette names, the layer-level checks (layer type, paint
 * clash, vector sources), and the same block across v1, v2 and stories.
 */

import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";

const HEAD = `type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
sources:
  tracts:
    type: geojson
    url: /data/tracts.geojson
  tiles:
    type: vector
    url: https://example.com/tiles.json
layers:
`;

function parse(layers: string) {
  return YAMLParser.safeParseMapBlock(HEAD + layers);
}

function only(result: ReturnType<typeof parse>) {
  expect(result.success).toBe(false);
  return result.errors;
}

describe("valid blocks", () => {
  it("accepts the four forms", () => {
    const result = parse(`  - id: explicit
    type: fill
    source: tracts
    classify:
      field: income
      breaks: [25000, 50000, 75000]
      palette: Blues
  - id: computed
    type: fill
    source: tracts
    classify:
      field: income
      method: quantile
      classes: 5
      palette: ylorrd
      noData: hide
  - id: zones
    type: fill
    source: tracts
    classify:
      field: zone
      categories:
        residential: "#f6e8c3"
        commercial: "#d8b365"
      other: "#bbbbbb"
  - id: places
    type: circle
    source: tracts
    classify:
      field: pop
      breaks: [1000, 10000]
      palette: Reds
      radius: [4, 8, 14]
`);
    expect(result.errors).toEqual([]);
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("accepts explicit breaks over a vector tile source", () => {
    const result = parse(`  - id: v
    type: fill
    source: tiles
    source-layer: tracts
    classify: { field: income, breaks: [10, 20] }
`);
    expect(result.success).toBe(true);
  });
});

describe("block errors — positioned, with did-you-mean", () => {
  it("names the method it was probably meant to be", () => {
    const [error] = only(parse(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, method: natural-breaks }
`));
    expect(error!.path).toBe("layers.0.classify.method");
    expect(error!.message).toContain('Did you mean "jenks"?');
    expect(error!.line).toBe(18);
  });

  it("names the palette it was probably meant to be, case-insensitively", () => {
    const [error] = only(parse(`  - id: a
    type: fill
    source: tracts
    classify:
      field: v
      breaks: [1, 2]
      palette: ylgnbuu
`));
    expect(error!.path).toBe("layers.0.classify.palette");
    expect(error!.message).toContain('Did you mean "YlGnBu"?');
    expect(error!.line).toBe(21);
  });

  it("says when a palette has too few colours for the classes", () => {
    const [error] = only(parse(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, method: quantile, classes: 12, palette: Blues }
`));
    expect(error!.message).toMatch(/Blues has colours for up to 9 classes/);
  });

  it("checks breaks go up", () => {
    const [error] = only(parse(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, breaks: [10, 5] }
`));
    expect(error!.path).toBe("layers.0.classify.breaks.1");
    expect(error!.message).toContain("breaks must go up");
  });

  it("counts colours against classes (n breaks → n + 1)", () => {
    const [error] = only(parse(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, breaks: [10, 20], colors: [red, blue] }
`));
    expect(error!.path).toBe("layers.0.classify.colors");
    expect(error!.message).toContain("3 classes (2 breaks + 1)");
  });

  it("needs a form, and only one", () => {
    expect(only(parse(`  - id: a
    type: fill
    source: tracts
    classify: { field: v }
`))[0]!.message).toContain("classify needs one of breaks:");
    expect(only(parse(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, breaks: [1], method: quantile }
`))[0]!.message).toContain("not both");
  });

  it("rejects a colour that is not one, and accepts hide for noData", () => {
    const errors = only(parse(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, breaks: [1], noData: greyy }
`));
    expect(errors[0]!.path).toBe("layers.0.classify.noData");
    expect(errors[0]!.message).toContain('Did you mean "grey"?');
  });

  it("says palette:, not scheme:", () => {
    const errors = only(parse(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, breaks: [1], scheme: Blues }
`));
    expect(errors.some((e) => e.message.includes("palette:, not scheme:"))).toBe(true);
  });

  it("warns on an unknown key with a did-you-mean", () => {
    const result = parse(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, breaks: [1], pallete: Blues }
`);
    expect(result.success).toBe(true);
    expect(result.warnings[0]!.message).toContain('Did you mean "palette"?');
  });
});

describe("layer checks", () => {
  it("refuses method: over a vector tile source, and says why", () => {
    const [error] = only(parse(`  - id: v
    type: fill
    source: tiles
    source-layer: tracts
    classify: { field: income, method: quantile }
`));
    expect(error!.path).toBe("layers.0.classify.method");
    expect(error!.message).toContain("only ever sees the tiles in view");
    expect(error!.message).toContain("breaks:");
    expect(error!.line).toBe(19);
  });

  it("refuses method: over a basemap source the document does not declare", () => {
    const [error] = only(parse(`  - id: v
    type: fill
    source: openmaptiles
    source-layer: water
    classify: { field: income, method: jenks }
`));
    expect(error!.message).toContain("not a GeoJSON source declared in this document");
  });

  it("refuses method: over a source read by view, in every spelling", () => {
    const bare = YAMLParser.safeParseMapBlock(
      HEAD.replace("url: /data/tracts.geojson", "url: /data/tracts.fgb\n    load: viewport") +
        `  - id: v
    type: fill
    source: tracts
    classify: { field: income, method: quantile }
`
    );
    expect(bare.success).toBe(false);
    expect(bare.errors[0]!.path).toBe("layers.0.classify.method");
    expect(bare.errors[0]!.message).toContain("load: viewport");

    // The object form.
    const object = YAMLParser.safeParseMapBlock(
      HEAD.replace(
        "url: /data/tracts.geojson",
        "url: /data/tracts.fgb\n    load: { mode: viewport, minzoom: 12 }"
      ) +
        `  - id: v
    type: fill
    source: tracts
    classify: { field: income, method: quantile }
`
    );
    expect(object.success).toBe(false);
    expect(object.errors[0]!.path).toBe("layers.0.classify.method");

    // An inline source on the layer.
    const inline = parse(`  - id: v
    type: fill
    source: { type: geojson, url: /data/t.fgb, load: { mode: viewport } }
    classify: { field: income, method: jenks }
`);
    expect(inline.success).toBe(false);
    expect(inline.errors[0]!.path).toBe("layers.0.classify.method");
  });

  it("keeps explicit breaks: on a source read by view", () => {
    const result = YAMLParser.safeParseMapBlock(
      HEAD.replace("url: /data/tracts.geojson", "url: /data/tracts.fgb\n    load: { mode: viewport }") +
        `  - id: v
    type: fill
    source: tracts
    classify: { field: income, breaks: [10, 20] }
`
    );
    expect(result.errors).toEqual([]);
  });

  it("refuses classify plus an authored colour on the same property", () => {
    const [error] = only(parse(`  - id: a
    type: fill
    source: tracts
    paint:
      fill-color: red
    classify: { field: v, breaks: [1] }
`));
    expect(error!.path).toBe("layers.0.paint.fill-color");
    expect(error!.message).toContain("Keep one");
    expect(error!.line).toBe(19);
  });

  it("allows an authored colour on another property", () => {
    const result = parse(`  - id: a
    type: fill
    source: tracts
    paint:
      fill-color: red
    classify: { field: v, breaks: [1], property: fill-outline-color }
`);
    expect(result.success).toBe(true);
  });

  it("checks property: against the layer type, with a did-you-mean", () => {
    const [error] = only(parse(`  - id: a
    type: circle
    source: tracts
    classify: { field: v, breaks: [1], property: circle-colour }
`));
    expect(error!.message).toContain('Did you mean "circle-color"?');
  });

  it("refuses a layer type with no colour to classify", () => {
    const [error] = only(parse(`  - id: a
    type: heatmap
    source: tracts
    classify: { field: v, breaks: [1] }
`));
    expect(error!.path).toBe("layers.0.classify");
    expect(error!.message).toContain("heatmap layer");
  });

  it("refuses radius: off circle layers", () => {
    const [error] = only(parse(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, breaks: [1], radius: [2, 4] }
`));
    expect(error!.path).toBe("layers.0.classify.radius");
  });

  it("refuses hide over a legacy-syntax filter", () => {
    const [error] = only(parse(`  - id: a
    type: fill
    source: tracts
    filter: ["==", "kind", "park"]
    classify: { field: v, breaks: [1], noData: hide }
`));
    expect(error!.path).toBe("layers.0.filter");
  });

  it("reports a layer check beside a block error", () => {
    const errors = only(parse(`  - id: a
    type: fill
    source: tiles
    source-layer: t
    paint: { fill-color: red }
    classify: { field: v, method: quantile, palette: bleus }
`));
    const paths = errors.map((e) => e.path);
    expect(paths).toContain("layers.0.classify.palette");
    expect(paths).toContain("layers.0.paint.fill-color");
  });
});

describe("v2 and stories", () => {
  it("validates classify on v2 style.layers[] the same way", () => {
    const ok = YAMLParser.safeParseMapBlock(`version: 2
type: map
id: m
style:
  center: [0, 0]
  zoom: 2
  sources:
    tracts: { type: geojson, url: /t.geojson }
  layers:
    - id: a
      type: fill
      source: tracts
      classify: { field: v, method: equal, classes: 4, palette: Greens }
`);
    expect(ok.errors).toEqual([]);
    const bad = YAMLParser.safeParseMapBlock(`version: 2
type: map
id: m
style:
  center: [0, 0]
  zoom: 2
  sources:
    tiles: { type: vector, url: "https://example.com/t.json" }
  layers:
    - id: a
      type: fill
      source: tiles
      source-layer: x
      classify: { field: v, method: equal }
`);
    expect(bad.success).toBe(false);
    expect(bad.errors[0]!.path).toBe("style.layers.0.classify.method");
  });

  it("refuses method: over a v2 source whose runtime.load reads by view", () => {
    const bad = YAMLParser.safeParseMapBlock(`version: 2
type: map
id: m
style:
  center: [0, 0]
  zoom: 2
  sources:
    parcels:
      type: geojson
      url: /p.fgb
      runtime:
        load: { mode: viewport, minzoom: 12 }
  layers:
    - id: a
      type: fill
      source: parcels
      classify: { field: v, method: quantile }
`);
    expect(bad.success).toBe(false);
    expect(bad.errors[0]!.path).toBe("style.layers.0.classify.method");
    expect(bad.errors[0]!.message).toContain("load: viewport");
  });

  it("validates classify in a story's layers", () => {
    const result = YAMLParser.safeParseScrollytellingBlock(`type: scrollytelling
id: s
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
sources:
  tiles: { type: vector, url: "https://example.com/t.json" }
layers:
  - id: a
    type: fill
    source: tiles
    source-layer: x
    classify: { field: v, method: jenks }
chapters:
  - id: one
    title: One
    center: [0, 0]
    zoom: 2
`);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.path === "layers.0.classify.method")).toBe(true);
  });
});
