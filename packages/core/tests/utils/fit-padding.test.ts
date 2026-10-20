/**
 * `fitTo`'s default padding (0.9, ml-aot.124): a margin around the data so
 * edge features aren't cut in half, scaled to the map, with room for the
 * attribution at the bottom; an author's `padding:` wins.
 */
import { describe, it, expect } from "vitest";
import { defaultFitPadding, fitToPadding } from "../../src/utils/fit-padding";
import { cameraForBounds, FIT_TO_REFERENCE_VIEWPORT } from "../../src/emitter/lower-fit-to";

describe("defaultFitPadding", () => {
  it("48 px on a desktop map, less on a phone, the attribution's room at the bottom", () => {
    expect(defaultFitPadding(1280, 800)).toEqual({ top: 48, right: 48, bottom: 64, left: 48 });
    // A phone: 8% of 390, and the compact attribution's expanded height.
    expect(defaultFitPadding(390, 844)).toEqual({ top: 31, right: 31, bottom: 63, left: 31 });
  });

  it("never takes more than half the map", () => {
    const p = defaultFitPadding(120, 80);
    expect(p.top + p.bottom).toBeLessThanOrEqual(40);
    expect(p.left + p.right).toBeLessThanOrEqual(60);
    expect(p.bottom).toBeGreaterThan(p.top);
  });

  it("an author's padding: is used as given, 0 included", () => {
    expect(fitToPadding({ padding: 0 }, { width: 1280, height: 800 })).toBe(0);
    expect(fitToPadding({ padding: 20 }, { width: 390, height: 844 })).toBe(20);
    expect(fitToPadding({}, { width: 1280, height: 800 })).toEqual(defaultFitPadding(1280, 800));
  });
});

describe("the export's camera follows the same rule", () => {
  it("a taller bottom margin moves the centre down (the data sits higher), as MapLibre's fitBounds does", () => {
    const box: [[number, number], [number, number]] = [
      [-10, -10],
      [10, 10],
    ];
    const even = cameraForBounds(box, FIT_TO_REFERENCE_VIEWPORT, 48);
    const uneven = cameraForBounds(box, FIT_TO_REFERENCE_VIEWPORT, { top: 48, right: 48, bottom: 64, left: 48 });
    expect(uneven.center[0]).toBeCloseTo(even.center[0], 6);
    expect(uneven.center[1]).toBeLessThan(even.center[1]);
    expect(uneven.zoom).toBeLessThanOrEqual(even.zoom);
  });
});
