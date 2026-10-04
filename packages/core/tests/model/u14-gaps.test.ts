/**
 * @file U14 gallery gaps through the parser and the model: `fitTo`,
 * `popups:`, and the `color-relief` layer type — v1/v2 parity (AE2), the
 * runtime-half placement, the renderer round trip, and the emit gate.
 */

import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { toModel } from "../../src/model/to-model";
import {
  denormalizeConfig,
  denormalizeLayers,
  denormalizeOptions,
} from "../../src/model/normalize";
import { projectStyle, applyRuntimeGate } from "../../src/emitter";
import type { MapModel } from "../../src/model/types";

function model(yaml: string): MapModel {
  const result = YAMLParser.safeParseMapBlock(yaml);
  if (!result.success) {
    throw new Error(
      "expected the document to parse, got errors:\n" +
        result.errors.map((e) => `- ${e.path}: ${e.message}`).join("\n")
    );
  }
  return toModel(result.data as never);
}

const BASEMAP = "https://demotiles.maplibre.org/style.json";

const V1_FIT = `
type: map
id: fit
config:
  center: [-77.02, 38.89]
  zoom: 12
  mapStyle: ${BASEMAP}
  fitTo:
    source: route
    padding: 20
sources:
  route:
    type: geojson
    data:
      type: Feature
      properties: {}
      geometry:
        type: LineString
        coordinates: [[-77.03, 38.89], [-77.00, 38.88]]
layers:
  - id: route
    type: line
    source: route
popups:
  - at: [-96, 37.8]
    closeOnClick: false
    content:
      - h1:
          - str: Hello World!
`;

const V2_FIT = `
version: 2
type: map
id: fit
style:
  basemap: ${BASEMAP}
  center: [-77.02, 38.89]
  zoom: 12
  sources:
    route:
      type: geojson
      data:
        type: Feature
        properties: {}
        geometry:
          type: LineString
          coordinates: [[-77.03, 38.89], [-77.00, 38.88]]
  layers:
    - id: route
      type: line
      source: route
runtime:
  fitTo:
    source: route
    padding: 20
  popups:
    - at: [-96, 37.8]
      closeOnClick: false
      content:
        - h1:
            - str: Hello World!
`;

describe("fitTo + popups — model placement and AE2", () => {
  it("v1 config.fitTo / root popups and v2 runtime.* normalize deep-equal", () => {
    const v1 = model(V1_FIT);
    const v2 = model(V2_FIT);
    expect(v1.runtime.fitTo).toEqual({ source: "route", padding: 20 });
    expect(v1.runtime.popups).toHaveLength(1);
    expect(v2).toEqual(v1);
  });

  it("fitTo leaves runtime.map (it is not a MapLibre constructor option)", () => {
    const v1 = model(V1_FIT);
    expect("fitTo" in v1.runtime.map).toBe(false);
    // ...so emit never reports it as a "map option"
    const warnings = projectStyle(v1, "with-fallbacks").warnings;
    const mapOptions = warnings.find((w) => w.construct === "map.options");
    expect(mapOptions?.message ?? "").not.toContain("fitTo");
  });

  it("the renderer round trip: config carries fitTo back, options carry popups", () => {
    const v1 = model(V1_FIT);
    expect((denormalizeConfig(v1) as Record<string, unknown>)["fitTo"]).toEqual({
      source: "route",
      padding: 20,
    });
    expect(denormalizeOptions(v1).popups).toEqual(v1.runtime.popups);
  });

  it("an empty popups list normalizes away", () => {
    const v1 = model(`
type: map
id: p
config:
  center: [0, 0]
  zoom: 2
  mapStyle: ${BASEMAP}
popups: []
`);
    expect(v1.runtime.popups).toBeUndefined();
  });

  it("popup content is required and validated like any popup", () => {
    const result = YAMLParser.safeParseMapBlock(`
type: map
id: p
config:
  center: [0, 0]
  zoom: 2
  mapStyle: ${BASEMAP}
popups:
  - at: [0, 0]
`);
    expect(result.success).toBe(false);
  });
});

describe("color-relief layer type", () => {
  const V1_RELIEF = `
type: map
id: relief
config:
  center: [11.45, 47.2]
  zoom: 10
  mapStyle: ${BASEMAP}
layers:
  - id: relief
    type: color-relief
    source:
      type: raster-dem
      url: https://demotiles.maplibre.org/terrain-tiles/tiles.json
      tileSize: 256
    paint:
      color-relief-opacity: 0.8
      color-relief-color:
        - interpolate
        - ["linear"]
        - ["elevation"]
        - 400
        - "rgb(4, 0, 108)"
        - 3500
        - "rgb(215, 5, 13)"
`;

  it("validates under v1 and v2 with no unknown-key warnings, deep-equal", () => {
    const parsed = YAMLParser.safeParseMapBlock(V1_RELIEF);
    expect(parsed.success).toBe(true);
    expect(parsed.warnings ?? []).toEqual([]);
    const v2 = model(`
version: 2
type: map
id: relief
style:
  basemap: ${BASEMAP}
  center: [11.45, 47.2]
  zoom: 10
  layers:
    - id: relief
      type: color-relief
      source:
        type: raster-dem
        url: https://demotiles.maplibre.org/terrain-tiles/tiles.json
        tileSize: 256
      paint:
        color-relief-opacity: 0.8
        color-relief-color:
          - interpolate
          - ["linear"]
          - ["elevation"]
          - 400
          - "rgb(4, 0, 108)"
          - 3500
          - "rgb(215, 5, 13)"
`);
    expect(v2).toEqual(model(V1_RELIEF));
    expect(denormalizeLayers(v2)[0]!.type).toBe("color-relief");
  });

  it("compiles through verbatim on emit", () => {
    const { style, warnings } = projectStyle(model(V1_RELIEF), "strict");
    const layer = (style["layers"] as Record<string, unknown>[])[0]!;
    expect(layer["type"]).toBe("color-relief");
    expect(warnings.filter((w) => w.kind === "lossy")).toEqual([]);
  });

  it("the runtime gate reports it lossy only for a declared target below 5.6", () => {
    const projected = projectStyle(model(V1_RELIEF), "with-fallbacks");
    const old = applyRuntimeGate(projected, { trust: "trusted", target: "4.7.1" });
    expect(old.warnings.find((w) => w.construct === "color-relief")).toMatchObject({
      kind: "lossy",
      path: "layers.relief",
    });
    // The layer still compiles through — nothing can be inlined for a type.
    expect((old.style["layers"] as unknown[]).length).toBe(1);
    for (const target of ["5.6.0", "5.24.0", undefined]) {
      const gated = applyRuntimeGate(projected, { trust: "trusted", target });
      expect(gated.warnings.find((w) => w.construct === "color-relief")).toBeUndefined();
    }
  });

  it("a misspelled layer type lists color-relief among the valid types", () => {
    const result = YAMLParser.safeParseMapBlock(V1_RELIEF.replace("type: color-relief", "type: color-releif"));
    expect(result.success).toBe(false);
    expect(result.errors[0]!.message).toContain("color-relief");
  });
});
