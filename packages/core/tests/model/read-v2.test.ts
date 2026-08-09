/**
 * @file U3 — the v2 → model reader, and the AE2 equivalence property.
 * @module @maplibre-yaml/core/tests/model/read-v2
 *
 * @description
 * AE2 is the linchpin: a v1 document and its v2 equivalent must normalize to
 * **deep-equal** {@link MapModel} values. The v2 reader is structural
 * rearrangement — it must reproduce `normalizeMapBlock`'s output exactly,
 * including the defaults v1's schemas materialize (`interactive: true` on
 * `runtime.map`, `fetchStrategy: "runtime"` on a geojson source's runtime).
 *
 * Both halves of every pair go through the real parser
 * ({@link YAMLParser.safeParseMapBlock}) and then {@link toModel}, so the
 * comparison exercises the shipped dispatch, not a hand-built block.
 */

import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { toModel } from "../../src/model/to-model";
import { projectStyle } from "../../src/emitter";
import type { MapModel } from "../../src/model/types";

/** Parse a block and turn it into the model, failing loudly on parse errors. */
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

describe("AE2 — v1 and its v2 equivalent normalize deep-equal", () => {
  it("minimal doc: the default-drift case (runtime.map.interactive)", () => {
    // v1's config requires center/zoom, so the "minimal" doc still carries a
    // camera; what it omits is any `runtime:`/non-camera option — which is what
    // exercises the interactive default drift.
    const v1 = model(`
type: map
id: minimal
config:
  center: [0, 0]
  zoom: 5
  mapStyle: ${BASEMAP}
`);
    const v2 = model(`
version: 2
type: map
id: minimal
style:
  basemap: ${BASEMAP}
  center: [0, 0]
  zoom: 5
`);
    // The drift this test exists to pin: v1 carries `runtime.map.interactive:
    // true` (MapConfigSchema `.default(true)`); the v2 runtime.map must too.
    expect(v2.runtime.map).toEqual({ interactive: true });
    expect(v2).toEqual(v1);
  });

  it("full doc: basemap, camera, a geojson source with refresh, an interactive layer", () => {
    const v1 = model(`
type: map
id: full
config:
  center: [-73.98, 40.75]
  zoom: 12
  mapStyle: ${BASEMAP}
sources:
  parcels:
    type: geojson
    url: /data/parcels.geojson
    refresh:
      refreshInterval: 5000
      updateStrategy: replace
layers:
  - id: massing
    type: fill
    source: parcels
    paint:
      fill-color: "#8899aa"
    interactive:
      hover: { highlight: true }
`);
    const v2 = model(`
version: 2
type: map
id: full
style:
  basemap: ${BASEMAP}
  center: [-73.98, 40.75]
  zoom: 12
  sources:
    parcels:
      type: geojson
      url: /data/parcels.geojson
      runtime:
        refresh:
          refreshInterval: 5000
          updateStrategy: replace
  layers:
    - id: massing
      type: fill
      source: parcels
      paint:
        fill-color: "#8899aa"
      runtime:
        interactive:
          hover: { highlight: true }
`);
    expect(v2).toEqual(v1);
  });

  it("inline geojson layer source: fetchStrategy lands in runtime.source, not spec.source (FIX A)", () => {
    // A geojson source materializes `fetchStrategy: "runtime"` by default. The
    // v1 twin partitions that into `runtime.source` via normalizeLayer; the v2
    // inline source must too — otherwise the key leaks into the erasable
    // `spec.source` (which MapLibre's validator rejects) and AE2 breaks.
    const v1 = model(`
type: map
id: inline
config:
  center: [0, 0]
  zoom: 5
  mapStyle: ${BASEMAP}
layers:
  - id: dots
    type: circle
    source:
      type: geojson
      data: { type: FeatureCollection, features: [] }
    paint:
      circle-color: "#111"
`);
    const v2 = model(`
version: 2
type: map
id: inline
style:
  basemap: ${BASEMAP}
  center: [0, 0]
  zoom: 5
  layers:
    - id: dots
      type: circle
      source:
        type: geojson
        data: { type: FeatureCollection, features: [] }
      paint:
        circle-color: "#111"
`);
    expect(v2).toEqual(v1);
    const layer = v2.style.layers[0]!;
    expect(layer.spec["source"]).not.toHaveProperty("fetchStrategy");
    expect(layer.spec["source"]).not.toHaveProperty("runtime");
    expect(layer.runtime["source"]).toEqual({ fetchStrategy: "runtime" });
  });

  it("state/parameters authored at the document root match the v1 twin (FIX B)", () => {
    const v1 = model(`
type: map
id: rooted
config:
  center: [0, 0]
  zoom: 5
  mapStyle: ${BASEMAP}
state:
  scenario:
    default: built
parameters:
  scenario:
    label: Scenario
    type: enum
`);
    const v2 = model(`
version: 2
type: map
id: rooted
style:
  basemap: ${BASEMAP}
  center: [0, 0]
  zoom: 5
state:
  scenario:
    default: built
parameters:
  scenario:
    label: Scenario
    type: enum
`);
    expect(v2).toEqual(v1);
    expect(v2.style.state).toEqual({ scenario: { default: "built" } });
    expect(v2.runtime.parameters).toEqual({
      scenario: { label: "Scenario", type: "enum" },
    });
  });

  it("runtime options: config MapLibre options == runtime.map (both carry interactive:true)", () => {
    const v1 = model(`
type: map
id: opts
config:
  center: [0, 0]
  zoom: 5
  mapStyle: ${BASEMAP}
  scrollZoom: true
  minZoom: 10
`);
    const v2 = model(`
version: 2
type: map
id: opts
style:
  basemap: ${BASEMAP}
  center: [0, 0]
  zoom: 5
runtime:
  map:
    scrollZoom: true
    minZoom: 10
`);
    expect(v2.runtime.map).toEqual({
      scrollZoom: true,
      minZoom: 10,
      interactive: true,
    });
    expect(v2).toEqual(v1);
  });

  it("geo-sugar `location`: v1 and v2 twins expand identically (ml-4jq)", () => {
    // GeoJSON sugar (V2-D2) is expanded pre-validation by a shared seam both
    // surfaces flow through, so a v1 sugar doc and its v2 twin must land on the
    // same model — the source's `location:` becomes a `Feature<Point>` in
    // `spec.data`, and the geojson `fetchStrategy: "runtime"` default lands in
    // `runtime` on both sides.
    const v1 = model(`
type: map
id: sugar-loc
config:
  center: [0, 0]
  zoom: 5
  mapStyle: ${BASEMAP}
sources:
  pts:
    type: geojson
    location:
      coordinates: [-73.98, 40.75]
      name: Midtown
layers:
  - id: dot
    type: circle
    source: pts
`);
    const v2 = model(`
version: 2
type: map
id: sugar-loc
style:
  basemap: ${BASEMAP}
  center: [0, 0]
  zoom: 5
  sources:
    pts:
      type: geojson
      location:
        coordinates: [-73.98, 40.75]
        name: Midtown
  layers:
    - id: dot
      type: circle
      source: pts
`);
    // The sugar expanded to a real Point Feature in the erasable spec half.
    expect(v2.style.sources.pts.spec).toMatchObject({
      type: "geojson",
      data: {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-73.98, 40.75] },
        properties: { name: "Midtown", description: "" },
      },
    });
    expect(v2.style.sources.pts.runtime).toEqual({ fetchStrategy: "runtime" });
    expect(v2).toEqual(v1);
  });

  it("geo-sugar `locations`: v1 and v2 twins expand to the same FeatureCollection (ml-4jq)", () => {
    const v1 = model(`
type: map
id: sugar-locs
config:
  center: [0, 0]
  zoom: 5
  mapStyle: ${BASEMAP}
sources:
  pins:
    type: geojson
    locations:
      - coordinates: [-73.98, 40.75]
        name: NYC
      - coordinates: [-118.24, 34.05]
        name: LA
layers:
  - id: dots
    type: circle
    source: pins
`);
    const v2 = model(`
version: 2
type: map
id: sugar-locs
style:
  basemap: ${BASEMAP}
  center: [0, 0]
  zoom: 5
  sources:
    pins:
      type: geojson
      locations:
        - coordinates: [-73.98, 40.75]
          name: NYC
        - coordinates: [-118.24, 34.05]
          name: LA
  layers:
    - id: dots
      type: circle
      source: pins
`);
    expect(v2.style.sources.pins.spec).toMatchObject({
      type: "geojson",
      data: { type: "FeatureCollection", features: [{}, {}] },
    });
    expect(v2).toEqual(v1);
  });

  it("geo-sugar is pure shorthand: sugar == the equivalent canonical GeoJSON (ml-4jq)", () => {
    // Authoring `region:` sugar and authoring the expanded Polygon Feature
    // directly must produce the identical model — sugar adds no meaning beyond
    // the GeoJSON it stands for, including the `description: ""` property default.
    const sugar = model(`
version: 2
type: map
id: sugar-eq
style:
  basemap: ${BASEMAP}
  center: [0, 0]
  zoom: 5
  sources:
    zone:
      type: geojson
      region:
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]
        name: Triangle
  layers:
    - id: fill
      type: fill
      source: zone
`);
    const canonical = model(`
version: 2
type: map
id: sugar-eq
style:
  basemap: ${BASEMAP}
  center: [0, 0]
  zoom: 5
  sources:
    zone:
      type: geojson
      data:
        type: Feature
        geometry:
          type: Polygon
          coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]
        properties:
          name: Triangle
          description: ""
  layers:
    - id: fill
      type: fill
      source: zone
`);
    expect(sugar).toEqual(canonical);
  });
});

describe("readV2Block — structural placement", () => {
  const doc = () =>
    model(`
version: 2
type: map
id: placement
style:
  basemap: ${BASEMAP}
  center: [-73.98, 40.75]
  zoom: 12
  state:
    scenario:
      default: built
  sources:
    parcels:
      type: geojson
      url: /data/parcels.geojson
      runtime:
        refresh:
          refreshInterval: 5000
          updateStrategy: replace
  layers:
    - id: massing
      type: fill
      source: parcels
      extends: some-base
      paint:
        fill-color: "#8899aa"
      runtime:
        label: Massing
        toggleable: true
runtime:
  container:
    style: "height: 100vh;"
`);

  it("puts basemap on style.basemap and camera on style.camera", () => {
    const m = doc();
    expect(m.style.basemap).toBe(BASEMAP);
    expect(m.style.camera).toMatchObject({
      center: [-73.98, 40.75],
      zoom: 12,
    });
  });

  it("puts a per-source runtime block on SourceModel.runtime; spec keeps only spec keys", () => {
    const m = doc();
    const parcels = m.style.sources["parcels"]!;
    expect(parcels.spec).toEqual({ type: "geojson", url: "/data/parcels.geojson" });
    expect(parcels.runtime).toMatchObject({
      refresh: { refreshInterval: 5000, updateStrategy: "replace" },
    });
    // No live-data key leaks into the erasable spec half.
    expect(parcels.spec).not.toHaveProperty("refresh");
    expect(parcels.spec).not.toHaveProperty("runtime");
  });

  it("puts a per-layer runtime block on LayerModel.runtime; spec keeps only spec keys", () => {
    const m = doc();
    const layer = m.style.layers[0]!;
    expect(layer.spec).toMatchObject({
      id: "massing",
      type: "fill",
      source: "parcels",
      paint: { "fill-color": "#8899aa" },
    });
    expect(layer.runtime).toMatchObject({ label: "Massing", toggleable: true });
    expect(layer.spec).not.toHaveProperty("runtime");
  });

  it("drops the reserved-unread `extends:` key — it never reaches the model", () => {
    const m = doc();
    const layer = m.style.layers[0]!;
    expect(layer.spec).not.toHaveProperty("extends");
    expect(layer.runtime).not.toHaveProperty("extends");
  });

  it("puts state on style.state and container on runtime.container", () => {
    const m = doc();
    expect(m.style.state).toEqual({ scenario: { default: "built" } });
    expect(m.runtime.container).toEqual({ style: "height: 100vh;" });
  });

  it("still yields runtime.map = {interactive:true} when no runtime block is authored", () => {
    const m = model(`
version: 2
type: map
id: no-runtime
style:
  basemap: ${BASEMAP}
`);
    expect(m.runtime.map).toEqual({ interactive: true });
  });
});

describe("AE2 round-trip — the emitter sees only the model", () => {
  it("a v2 doc and its v1 twin project to the same style.json", () => {
    const v1 = model(`
type: map
id: rt
config:
  center: [-73.98, 40.75]
  zoom: 12
  mapStyle: ${BASEMAP}
sources:
  s:
    type: geojson
    data: { type: FeatureCollection, features: [] }
layers:
  - id: dots
    type: circle
    source: s
    paint:
      circle-color: "#111"
`);
    const v2 = model(`
version: 2
type: map
id: rt
style:
  basemap: ${BASEMAP}
  center: [-73.98, 40.75]
  zoom: 12
  sources:
    s:
      type: geojson
      data: { type: FeatureCollection, features: [] }
  layers:
    - id: dots
      type: circle
      source: s
      paint:
        circle-color: "#111"
`);
    const styleV1 = projectStyle(v1).style;
    const styleV2 = projectStyle(v2).style;
    expect(styleV2).toEqual(styleV1);
  });
});
