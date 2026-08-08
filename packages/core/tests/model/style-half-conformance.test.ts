/**
 * @file The style half of the model must be spec-valid
 * @module @maplibre-yaml/core/tests/model
 *
 * @description
 * The gap this closes: the round-trip tests are symmetric by construction —
 * `partition` produces disjoint halves and `denormalize` spreads them back — so
 * they can only ever detect *loss*, never *misclassification*. And the renderer
 * suites drive `LayerManager` directly, so they never see the model at all.
 * Nothing connected `model.style` to "would MapLibre accept this".
 *
 * That gap is what let a layer's inline `source:` keep its live-data keys on
 * the style half undetected — the exact leak the 0.4.0 named-source scrub
 * closed. These tests assert the edge that actually matters for the emitter: a
 * v1 document, normalized, projected, and handed to MapLibre's own validator.
 *
 * The projection here is deliberately naive — take the spec halves, assemble a
 * style. The real emitter (U4) does more, but if the naive projection is not
 * spec-valid then no emitter built on this model can be.
 */

import { describe, it, expect } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { normalizeMapBlock, SOURCE_RUNTIME_KEYS, LAYER_RUNTIME_KEYS } from "../../src/model";
import type { V1MapInput, MapModel } from "../../src/model";

/**
 * The naive projection: style half in, style.json out.
 *
 * @remarks
 * One transformation is not optional and is worth recording here, because the
 * emitter will have to do it: **the style spec has no inline-source concept.**
 * `layer.source` must be a string naming an entry in `sources:`, so a layer
 * that declares its source inline — the common authoring shape in this format —
 * has to be hoisted into a generated named source. Skipping that yields
 * `layers[0].source: string expected, object found`.
 *
 * Everything else here is a straight copy, which is the point: if the style
 * half needs more than hoisting to be spec-valid, the split is wrong.
 */
function project(model: MapModel): Record<string, unknown> {
  const sources: Record<string, unknown> = {};
  for (const [name, source] of Object.entries(model.style.sources)) {
    sources[name] = source.spec;
  }

  const layers = model.style.layers.map((layer) => {
    const spec = { ...layer.spec };
    if (typeof spec["source"] === "object" && spec["source"] !== null) {
      const generated = `${String(spec["id"])}-source`;
      sources[generated] = spec["source"];
      spec["source"] = generated;
    }
    return spec;
  });

  const style: Record<string, unknown> = {
    version: 8,
    ...model.style.camera,
    sources,
    layers,
  };
  if (model.style.state !== undefined) style["state"] = model.style.state;
  return style;
}

const errorsFor = (input: V1MapInput) =>
  validateStyleMin(project(normalizeMapBlock(input)) as never);

describe("the style half projects to a spec-valid style", () => {
  it("for a named source carrying live-data configuration", () => {
    expect(
      errorsFor({
        id: "m",
        config: { center: [0, 0], zoom: 5 },
        sources: {
          parcels: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
            promoteId: "bbl",
            refresh: { refreshInterval: 5000 },
            cache: { enabled: true },
          },
        },
        layers: [{ id: "a", type: "circle", source: "parcels" }],
      } as never)
    ).toEqual([]);
  });

  /**
   * The regression this file exists for. An inline source is the common
   * authoring shape, and `fetchStrategy` is materialized by the geojson schema
   * on every one of them — so before inline sources were partitioned, this
   * failed for essentially any document, not just live-data ones.
   */
  it("for a layer whose source is declared inline", () => {
    expect(
      errorsFor({
        id: "m",
        config: { center: [0, 0], zoom: 5 },
        layers: [
          {
            id: "a",
            type: "circle",
            source: {
              type: "geojson",
              data: { type: "FeatureCollection", features: [] },
              fetchStrategy: "runtime",
              refresh: { refreshInterval: 5000 },
              cache: { enabled: true },
              loading: { enabled: true },
            },
            paint: { "circle-color": "#111" },
          },
        ],
      } as never)
    ).toEqual([]);
  });

  it("for a layer carrying every runtime-side key", () => {
    expect(
      errorsFor({
        id: "m",
        config: { center: [0, 0], zoom: 5 },
        sources: { s: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
        layers: [
          {
            id: "a",
            type: "circle",
            source: "s",
            before: "other",
            label: "Points",
            toggleable: true,
            legend: { color: "#111", label: "Points" },
            interactive: { hover: { highlight: true } },
          },
        ],
      } as never)
    ).toEqual([]);
  });

  it("for a document declaring state", () => {
    expect(
      errorsFor({
        id: "m",
        config: { center: [0, 0], zoom: 5 },
        state: { scenario: { default: "built" } },
        sources: { s: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
        layers: [{ id: "a", type: "circle", source: "s" }],
      } as never)
    ).toEqual([]);
  });
});

/**
 * Table-driven so trimming either list fails immediately.
 *
 * @remarks
 * Mutation testing during review showed that deleting `stream`, `loading`,
 * `prefetchedData`, or `fetchStrategy` from SOURCE_RUNTIME_KEYS left every test
 * in the repo green — the source tests only exercised `refresh`, `cache`, and
 * the legacy fields. These are the keys whose misclassification the emitter
 * would turn into an invalid style.
 */
describe("every declared runtime key lands on the runtime half", () => {
  it.each([...SOURCE_RUNTIME_KEYS])("source key %s", (key) => {
    const model = normalizeMapBlock({
      id: "m",
      config: { center: [0, 0], zoom: 5 },
      sources: { s: { type: "geojson", url: "/x.geojson", [key]: {} } },
    } as never);
    const source = model.style.sources["s"]!;
    expect(Object.keys(source.runtime)).toContain(key);
    expect(Object.keys(source.spec)).not.toContain(key);
  });

  it.each([...LAYER_RUNTIME_KEYS])("layer key %s", (key) => {
    const model = normalizeMapBlock({
      id: "m",
      config: { center: [0, 0], zoom: 5 },
      layers: [{ id: "a", type: "circle", source: "s", [key]: {} }],
    } as never);
    const layer = model.style.layers[0]!;
    expect(Object.keys(layer.runtime)).toContain(key);
    expect(Object.keys(layer.spec)).not.toContain(key);
  });
});
