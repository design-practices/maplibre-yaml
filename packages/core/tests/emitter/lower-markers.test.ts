/**
 * @file Markers lowering — the format's first fallback-class eject (U5, R5/R8)
 */

import { describe, it, expect } from "vitest";
import { lowerMarkers, MARKERS_LAYER_ID, MARKERS_SOURCE_ID } from "../../src/emitter/lower-markers";
import { projectStyle } from "../../src/emitter/project";
import { attachSpriteAssets, DOCUMENT_SPRITE_ID } from "../../src/emitter/assets";
import { normalizeMapBlock } from "../../src/model/normalize";
import { ejectClasses } from "../../src/eject/registrations";
import type { V1MapInput } from "../../src/model/types";

const doc = (markers: unknown) =>
  normalizeMapBlock({
    id: "pins",
    config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" },
    layers: [
      {
        id: "base-data",
        type: "circle",
        source: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      },
    ],
    markers,
  } as unknown as V1MapInput);

const MARKERS = [
  { at: [0, 0] },
  { at: [10, 10], color: "#e63946", size: 1.5 },
  { at: [20, 20] }, // same look as the first — the sprite must dedupe
];

describe("lowerMarkers (KTD4 pre-pass)", () => {
  it("moves markers out of the runtime half into a synthesized source + symbol layer", () => {
    const { model } = lowerMarkers(doc(MARKERS));

    expect(model.runtime.markers).toBeUndefined();
    expect(model.style.sources[MARKERS_SOURCE_ID]).toBeDefined();
    const layer = model.style.layers.at(-1)!;
    expect(layer.spec["id"]).toBe(MARKERS_LAYER_ID);
    expect(layer.spec["type"]).toBe("symbol");
    // Appended last: pins draw on top, like live DOM markers.
    expect(model.style.layers[0]!.spec["id"]).toBe("base-data");
  });

  it("generates one pin asset per distinct look, referenced with the mlym: prefix", () => {
    const { model, assets } = lowerMarkers(doc(MARKERS));

    // Three markers, two looks — dedupe happens in the sprite pipeline, but
    // the identical descriptors collapse there; here we assert the features
    // reference per-look names.
    const source = model.style.sources[MARKERS_SOURCE_ID]!.spec as any;
    const icons = source.data.features.map((f: any) => f.properties["mlym:icon"]);
    expect(new Set(icons).size).toBe(2);
    expect(icons[0]).toBe(icons[2]);
    expect(assets).toHaveLength(3);

    const layout = (model.style.layers.at(-1)!.spec as any).layout;
    expect(layout["icon-image"]).toEqual(["concat", "mlym:", ["get", "mlym:icon"]]);
    expect(layout["icon-anchor"]).toBe("bottom");
  });

  it("reports the lowering as lossy, and attachSpriteAssets dedupes the descriptors", () => {
    const { model, assets, warnings } = lowerMarkers(doc(MARKERS));
    const markerWarning = warnings.find((w) => w.construct === "markers");
    expect(markerWarning?.kind).toBe("lossy");
    expect(markerWarning?.ejectClass).toBe("fallback");

    const result = attachSpriteAssets(projectStyle(model), assets);
    expect(result.assets).toHaveLength(2); // identical pins collapsed
    expect(result.style["sprite"]).toEqual([
      { id: DOCUMENT_SPRITE_ID, url: DOCUMENT_SPRITE_ID },
    ]);
  });

  it("icon URLs substitute the default pin with a lossy warning (until U6 embeds them)", () => {
    const { warnings } = lowerMarkers(doc([{ at: [0, 0], icon: "https://x.example/pin.png" }]));
    const iconWarning = warnings.find((w) => w.path === "markers[0].icon");
    expect(iconWarning?.kind).toBe("lossy");
    expect(iconWarning?.message).toMatch(/default pin/);
  });

  it("passes a marker-less model through by reference", () => {
    const model = doc(undefined);
    expect(lowerMarkers(model).model).toBe(model);
  });

  it("an empty markers list normalizes away — nothing lossy, strict passes", () => {
    // Zero markers lose nothing on emit, so normalize drops the key entirely
    // (both format versions) and strict never sees a fallback construct.
    const model = doc([]);
    expect(model.runtime.markers).toBeUndefined();
    expect(lowerMarkers(model).model).toBe(model);
    expect(() => projectStyle(model, "strict")).not.toThrow();
  });

  it("refuses to lower when the document already uses the reserved ids", () => {
    const collidingSource = normalizeMapBlock({
      id: "pins",
      config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" },
      layers: [
        {
          id: MARKERS_LAYER_ID,
          type: "circle",
          source: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
      ],
      markers: MARKERS,
    } as unknown as V1MapInput);
    expect(() => lowerMarkers(collidingSource)).toThrow(/mlym-markers/);
  });
});

describe("the fallback contract (R5)", () => {
  it("markers is registered as fallback with a working eject()", () => {
    const definition = ejectClasses.require("markers");
    expect(definition.class).toBe("fallback");
    const lowering = definition.eject!({ value: MARKERS, path: "markers" });
    expect(lowering.layers?.[0]?.["id"]).toBe(MARKERS_LAYER_ID);
    expect(lowering.sources?.[MARKERS_SOURCE_ID]).toBeDefined();
    expect(lowering.assets?.length).toBeGreaterThan(0);
  });

  it("the eject() hook and the lowerMarkers pre-pass cannot drift", () => {
    // Both are backed by buildMarkersLowering; this pins the parity so a
    // future edit to one path cannot silently diverge from the other.
    const hook = ejectClasses.require("markers").eject!({ value: MARKERS, path: "markers" });
    const { model, assets } = lowerMarkers(doc(MARKERS));
    expect(hook.sources?.[MARKERS_SOURCE_ID]).toEqual(model.style.sources[MARKERS_SOURCE_ID]!.spec);
    expect(hook.layers?.[0]).toEqual(model.style.layers.at(-1)!.spec);
    expect(hook.assets).toEqual(assets);
  });

  it("the un-lowered strict message points authors at --with-fallbacks", () => {
    const { warnings } = projectStyle(doc(MARKERS));
    const warning = warnings.find((w) => w.construct === "markers");
    expect(warning?.message).toContain("--with-fallbacks");
  });

  it("an UN-lowered markers document is lossy in projectStyle — --strict refuses it", () => {
    // Direct projection without the pre-pass: the fallback exists but wasn't
    // substituted, which is a visual drop and must fail strict mode.
    const model = doc(MARKERS);
    const { warnings } = projectStyle(model);
    const warning = warnings.find((w) => w.construct === "markers");
    expect(warning?.kind).toBe("lossy");
    expect(() => projectStyle(model, "strict")).toThrow(/strict/);
  });

  it("a lowered model passes strict for everything except the lowering itself", () => {
    // The lowering happens only under --with-fallbacks (the cli skips it in
    // strict mode precisely so strict sees the lossy construct) — but a
    // pre-lowered model given to strict projectStyle is clean spec surface.
    const { model } = lowerMarkers(doc(MARKERS));
    expect(() => projectStyle(model, "strict")).not.toThrow();
  });
});
