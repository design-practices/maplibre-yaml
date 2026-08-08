/**
 * @file Tests for the format-v2 map block schema (U2)
 * @module @maplibre-yaml/core/tests/schemas/map-v2
 *
 * @description
 * U2 is validation only: a `version: 2` document validates against
 * {@link MapBlockV2Schema} and parses to a raw v2 block. Turning that block
 * into a {@link MapModel} is U3's job — the `toModel` v2 branch is still a
 * stub, which the final test here pins.
 *
 * The document mirrors the appendix of the format-v2 definition plan, with one
 * reconciliation: `state:` is authored in the shipped {@link StateSchema}
 * shape — `{ key: { default: value } }` — rather than the appendix's flat
 * `{ key: value }` sketch, because U1 shipped `StateSchema` as the contract and
 * this unit reuses it. Parameter `default` likewise lives in `state`, where the
 * spec puts it, not in `runtime.parameters` (which is presentation metadata).
 */

import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { MapBlockV2Schema } from "../../src/schemas/map-v2.schema";
import { toModel } from "../../src/model/to-model";

/** The appendix v2 document, reconciled to the shipped sub-schemas. */
const APPENDIX_V2 = `
version: 2
type: map
id: underbuilt
style:
  basemap: https://demotiles.maplibre.org/style.json
  center: [-73.98, 40.75]
  zoom: 12
  pitch: 45
  metadata:
    title: NYC underbuilt potential
  state:
    scenario:
      default: built
  sources:
    parcels:
      type: geojson
      url: /data/parcels.geojson
      promoteId: bbl
      runtime:
        refresh:
          refreshInterval: 300000
          updateStrategy: merge
          updateKey: bbl
  layers:
    - id: massing
      type: fill-extrusion
      source: parcels
      paint:
        fill-extrusion-color: "#8899aa"
        fill-extrusion-height:
          - case
          - ["==", ["global-state", "scenario"], "built"]
          - ["get", "built_ffa"]
          - ["get", "zoned_ffa"]
      runtime:
        label: Massing
        toggleable: true
        legend:
          color: "#8899aa"
          label: Floor area
        interactive:
          hover: { highlight: true }
          click:
            popup:
              - h3: [{ property: address }]
              - p:
                  - str: "Built: "
                  - { property: built_ffa, format: ",.0f" }
runtime:
  map:
    minZoom: 10
    scrollZoom: true
  parameters:
    scenario:
      label: Massing scenario
      type: enum
      values: [built, potential]
  controls:
    navigation: true
  container:
    style: "height: 100vh;"
x-map-party:
  allowLocalFilters: true
`;

describe("MapBlockV2Schema — direct validation", () => {
  it("is a usable Zod schema exported from the schemas barrel", () => {
    // A minimal v2 block parses directly against the schema (no parser).
    const parsed = MapBlockV2Schema.safeParse({
      version: 2,
      type: "map",
      id: "min",
      style: { layers: [] },
    });
    expect(parsed.success).toBe(true);
  });
});

describe("safeParseMapBlock — v2 dispatch (U2)", () => {
  it("validates the full appendix v2 document clean (success true)", () => {
    const result = YAMLParser.safeParseMapBlock(APPENDIX_V2);
    if (!result.success) {
      // Surface the errors for a readable failure.
      throw new Error(
        "expected v2 doc to validate, got errors:\n" +
          result.errors.map((e) => `- ${e.path}: ${e.message}`).join("\n")
      );
    }
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.version).toBe(2);
    expect((data.style as Record<string, unknown>).basemap).toBe(
      "https://demotiles.maplibre.org/style.json"
    );
  });

  it("accepts a per-source `runtime:` block in its v2 position", () => {
    const yaml = `
version: 2
type: map
id: src-runtime
style:
  sources:
    parcels:
      type: geojson
      url: /data/parcels.geojson
      runtime:
        refresh:
          refreshInterval: 5000
          updateStrategy: replace
  layers: []
`;
    const result = YAMLParser.safeParseMapBlock(yaml);
    expect(result.success).toBe(true);
  });

  it("accepts a per-layer `runtime:` block in its v2 position", () => {
    const yaml = `
version: 2
type: map
id: layer-runtime
style:
  sources:
    pts:
      type: geojson
      url: /data/pts.geojson
  layers:
    - id: dots
      type: circle
      source: pts
      paint:
        circle-radius: 4
      runtime:
        label: Dots
        toggleable: false
        interactive:
          click:
            popup:
              - p: [{ property: name }]
`;
    const result = YAMLParser.safeParseMapBlock(yaml);
    expect(result.success).toBe(true);
  });

  it("accepts a reserved `extends:` key on a layer (unread)", () => {
    const yaml = `
version: 2
type: map
id: extends-key
style:
  sources:
    pts:
      type: geojson
      url: /data/pts.geojson
  layers:
    - id: dots
      type: circle
      source: pts
      extends: some-base-layer
      paint:
        circle-radius: 4
`;
    const result = YAMLParser.safeParseMapBlock(yaml);
    expect(result.success).toBe(true);
  });

  it("accepts an `x-map-party` block at the document root without an unknown-key warning", () => {
    const yaml = `
version: 2
type: map
id: ext
style:
  layers: []
x-map-party:
  allowLocalFilters: true
`;
    const result = YAMLParser.safeParseMapBlock(yaml);
    expect(result.success).toBe(true);
    const warnMessages = result.warnings.map((w) => w.message).join(" ");
    expect(warnMessages).not.toMatch(/x-map-party/i);
    expect(warnMessages).not.toMatch(/unknown key/i);
  });
});

describe("safeParseMapBlock — v2 unknown-key warnings (U2)", () => {
  it("warns when `mapStyle` is used at the style root instead of `basemap`", () => {
    const yaml = `
version: 2
type: map
id: wrong-basemap
style:
  mapStyle: https://demotiles.maplibre.org/style.json
  layers: []
`;
    const result = YAMLParser.safeParseMapBlock(yaml);
    const warnMessages = result.warnings.map((w) => w.message).join(" ");
    expect(warnMessages).toMatch(/mapStyle/);
    expect(warnMessages).toMatch(/unknown key/i);
  });

  it("warns when `refresh` is placed on a source (v1 position, not source.runtime)", () => {
    const yaml = `
version: 2
type: map
id: wrong-refresh
style:
  sources:
    parcels:
      type: geojson
      url: /data/parcels.geojson
      refresh:
        refreshInterval: 5000
  layers: []
`;
    const result = YAMLParser.safeParseMapBlock(yaml);
    const refreshWarning = result.warnings.find((w) =>
      /refresh/.test(w.path)
    );
    expect(refreshWarning).toBeDefined();
    expect(refreshWarning?.message).toMatch(/unknown key/i);
  });

  it("warns on a typo'd top-level `stlye:` key", () => {
    const yaml = `
version: 2
type: map
id: typo
stlye:
  layers: []
style:
  layers: []
`;
    const result = YAMLParser.safeParseMapBlock(yaml);
    const typoWarning = result.warnings.find((w) => w.path === "stlye");
    expect(typoWarning).toBeDefined();
    expect(typoWarning?.message).toMatch(/unknown key/i);
    // Did-you-mean should point at `style`.
    expect(typoWarning?.suggestion).toBe("style");
  });
});

describe("v2 → model seam (U3 landed readV2Block)", () => {
  it("toModel turns the appendix v2 block into a model", () => {
    const result = YAMLParser.safeParseMapBlock(APPENDIX_V2);
    expect(result.success).toBe(true);
    const model = toModel(result.data as never);
    expect(model.id).toBe("underbuilt");
    expect(model.style.basemap).toBe(
      "https://demotiles.maplibre.org/style.json"
    );
    // The v2 runtime.map carries v1's interactive default (AE2).
    expect(model.runtime.map).toMatchObject({ interactive: true });
  });
});

describe("v2 source cross-field guards (FIX C)", () => {
  const withSource = (sourceBody: string) => `
version: 2
type: map
id: guard
style:
  basemap: https://demotiles.maplibre.org/style.json
  sources:
    s:
${sourceBody}
  layers: []
`;

  it("rejects a geojson source with no url/data/prefetchedData", () => {
    const result = YAMLParser.safeParseMapBlock(
      withSource("      type: geojson")
    );
    expect(result.success).toBe(false);
  });

  it("accepts a geojson source that carries data", () => {
    const result = YAMLParser.safeParseMapBlock(
      withSource(
        "      type: geojson\n" +
          "      data: { type: FeatureCollection, features: [] }"
      )
    );
    expect(result.success).toBe(true);
  });

  it("accepts a geojson source that carries prefetchedData under runtime", () => {
    const result = YAMLParser.safeParseMapBlock(
      withSource(
        "      type: geojson\n" +
          "      runtime:\n" +
          "        prefetchedData: { type: FeatureCollection, features: [] }"
      )
    );
    expect(result.success).toBe(true);
  });

  it("rejects a vector source with neither url nor tiles", () => {
    const result = YAMLParser.safeParseMapBlock(
      withSource("      type: vector")
    );
    expect(result.success).toBe(false);
  });

  it("accepts a vector source with a url", () => {
    const result = YAMLParser.safeParseMapBlock(
      withSource("      type: vector\n      url: /tiles/v3.json")
    );
    expect(result.success).toBe(true);
  });
});
