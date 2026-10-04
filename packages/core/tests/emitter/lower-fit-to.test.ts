/**
 * @file fitTo eject lowering (U14, ml-chh.9) — the computed camera, the
 * honest fallbacks, and the one-implementation parity with the registry.
 */

import { describe, it, expect } from "vitest";
import {
  lowerFitTo,
  cameraForBounds,
  FIT_TO_REFERENCE_VIEWPORT,
} from "../../src/emitter/lower-fit-to";
import { projectStyle, EmitError } from "../../src/emitter/project";
import { ejectClasses } from "../../src/eject/registrations";
import { normalizeMapBlock } from "../../src/model/normalize";
import type { MapModel } from "../../src/model/types";

const LINE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [-77.0366, 38.8987],
          [-77.0082, 38.8899],
        ],
      },
    },
  ],
};

function doc(sources: Record<string, unknown>, fitTo: Record<string, unknown>): MapModel {
  return normalizeMapBlock({
    id: "fit",
    config: { center: [0, 0], zoom: 2, fitTo } as never,
    sources: sources as never,
    layers: [],
  });
}

describe("cameraForBounds — MapLibre's fitBounds math", () => {
  it("centers a symmetric box on the origin and fits the tighter axis", () => {
    const { center, zoom } = cameraForBounds([
      [-10, -10],
      [10, 10],
    ]);
    expect(center).toEqual([0, 0]);
    // 768px over the Mercator height of ±10° is the binding axis: log2(26.86).
    expect(zoom).toBeCloseTo(4.75, 2);
  });

  it("centers on the Mercator midpoint, not the latitude midpoint", () => {
    const { center } = cameraForBounds([
      [0, 0],
      [10, 60],
    ]);
    // The Mercator midpoint of 0..60° sits well north of 30°.
    expect(center[1]).toBeGreaterThan(34);
    expect(center[0]).toBeCloseTo(5, 6);
  });

  it("padding shrinks the usable frame; a single point lands on maxZoom", () => {
    const box: [[number, number], [number, number]] = [
      [-10, -10],
      [10, 10],
    ];
    expect(cameraForBounds(box, FIT_TO_REFERENCE_VIEWPORT, 100).zoom).toBeLessThan(
      cameraForBounds(box).zoom
    );
    const point = cameraForBounds([
      [5, 5],
      [5, 5],
    ], FIT_TO_REFERENCE_VIEWPORT, 0, 14);
    expect(point.zoom).toBe(14);
    expect(point.center).toEqual([5, 5]);
  });
});

describe("lowerFitTo (pre-pass)", () => {
  it("inline GeoJSON: the camera is replaced and fitTo leaves the runtime half", () => {
    const model = doc(
      { route: { type: "geojson", data: LINE } },
      { source: "route", padding: 20 }
    );
    const { model: lowered, warnings } = lowerFitTo(model);
    expect(lowered.runtime.fitTo).toBeUndefined();
    expect(lowered.style.camera.center[0]).toBeCloseTo(-77.0224, 3);
    expect(lowered.style.camera.zoom).toBeGreaterThan(12);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: "lossy",
      construct: "fitTo",
      ejectClass: "fallback",
    });
    expect(warnings[0]!.message).toContain("1024×768");
    // The emitted style carries the computed camera and no runtime trace.
    const emitted = projectStyle(lowered, "strict");
    expect(emitted.style["center"]).toEqual(lowered.style.camera.center);
    expect(JSON.stringify(emitted.style)).not.toContain("fitTo");
  });

  it("a fetched source keeps the authored camera, said out loud", () => {
    const model = doc(
      { route: { type: "geojson", url: "https://example.com/route.geojson" } },
      { source: "route" }
    );
    const { model: lowered, warnings } = lowerFitTo(model);
    expect(lowered.style.camera).toEqual({ center: [0, 0], zoom: 2 });
    expect(lowered.runtime.fitTo).toBeUndefined();
    expect(warnings[0]!.kind).toBe("lossy");
    expect(warnings[0]!.message).toMatch(/fetched/);
  });

  it("a tiled source or a missing name keeps the camera with a lossy warning", () => {
    const vector = lowerFitTo(
      doc({ tiles: { type: "vector", url: "https://example.com/t.json" } }, { source: "tiles" })
    );
    expect(vector.warnings[0]!.message).toMatch(/vector source/);
    const missing = lowerFitTo(doc({}, { source: "nope" }));
    expect(missing.warnings[0]!.message).toMatch(/not an entry in `sources:`/);
  });

  it("a model without fitTo passes through by reference", () => {
    const model = doc({}, undefined as never);
    expect(lowerFitTo(model).model).toBe(model);
  });

  it("un-lowered, fitTo is a lossy fallback — --strict refuses it", () => {
    const model = doc({ route: { type: "geojson", data: LINE } }, { source: "route" });
    const warnings = projectStyle(model, "with-fallbacks").warnings;
    expect(warnings.find((w) => w.construct === "fitTo")?.kind).toBe("lossy");
    expect(() => projectStyle(model, "strict")).toThrow(EmitError);
  });

  it("the registry eject() hook and the pre-pass cannot drift", () => {
    const model = doc({ route: { type: "geojson", data: LINE } }, { source: "route" });
    const hook = ejectClasses.require("fitTo").eject!({
      value: model.runtime.fitTo,
      path: "fitTo",
      model,
    });
    const { model: lowered, warnings } = lowerFitTo(model);
    expect(hook.camera).toEqual({
      center: lowered.style.camera.center,
      zoom: lowered.style.camera.zoom,
    });
    expect(hook.warnings).toEqual(warnings);
  });

  it("without the document the hook declares it cannot compute (never throws)", () => {
    const hook = ejectClasses.require("fitTo").eject!({
      value: { source: "route" },
      path: "fitTo",
    });
    expect(hook.camera).toBeUndefined();
    expect(hook.warnings?.[0]?.kind).toBe("lossy");
  });
});

describe("popups on emit (U14)", () => {
  it("report as a declared-absence contract warning, never silently", () => {
    const model = normalizeMapBlock({
      id: "p",
      config: { center: [0, 0], zoom: 2 } as never,
      layers: [],
      popups: [{ at: [0, 0], content: [{ p: [{ str: "hi" }] }] }] as never,
    });
    const { warnings } = projectStyle(model, "strict");
    expect(warnings.find((w) => w.construct === "popups")).toMatchObject({
      kind: "contract",
      ejectClass: "declared-absence",
    });
  });
});
