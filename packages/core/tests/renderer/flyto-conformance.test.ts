/**
 * Conformance: the flyTo options we build are options MapLibre can use.
 *
 * @remarks
 * The event-handler suite asserts `mockMap.flyTo` was called with an object of
 * our own choosing, which cannot fail on a center MapLibre would reject — it
 * never reaches MapLibre. A bad center throws inside `flyTo` at runtime and the
 * camera never moves, which is indistinguishable from the silent no-op this
 * unit exists to fix. So the center is resolved here with the real `LngLat`.
 *
 * Full end-to-end proof (the camera actually animating) needs a WebGL context
 * and belongs in the browser verification fixture, not here.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  const w = globalThis as any;
  w.URL.createObjectURL ??= () => "blob:conformance";
  w.URL.revokeObjectURL ??= () => {};
});

import { LngLat } from "maplibre-gl";
import { CLICK_INTERACTIONS } from "../../src/interactions";

/** Drive the real flyTo interaction and capture the options it builds. */
function optionsFor(flyTo: unknown, clickedAt: LngLat) {
  const entry = CLICK_INTERACTIONS.find((i) => i.name === "flyTo")!;
  const runtime = entry.create({ showPopup: () => {} });
  const calls: any[] = [];
  const map = { flyTo: (o: any) => calls.push(o) } as any;

  runtime.run(entry.select({ flyTo }), {
    map,
    layerId: "l",
    sourceId: "l-source",
    feature: { properties: {} },
    lngLat: clickedAt,
  } as any);

  return calls[0];
}

describe("flyTo options are usable by MapLibre", () => {
  let clicked: LngLat;

  beforeEach(() => {
    clicked = new LngLat(-74.006, 40.7128);
  });

  it("defaults the center to a center MapLibre can resolve", () => {
    const options = optionsFor({ zoom: 12 }, clicked);

    // LngLat.convert is what MapLibre calls internally; a shape it rejects
    // throws here exactly as it would throw inside flyTo.
    const center = LngLat.convert(options.center as any);
    expect(center.lng).toBeCloseTo(-74.006);
    expect(center.lat).toBeCloseTo(40.7128);
    expect(options.zoom).toBe(12);
  });

  it("resolves an explicit tuple center", () => {
    const options = optionsFor({ center: [10, 20], zoom: 8 }, clicked);

    const center = LngLat.convert(options.center as any);
    expect([center.lng, center.lat]).toEqual([10, 20]);
  });

  it("keeps zoom 0 and duration 0 rather than dropping them", () => {
    const zeroZoom = optionsFor({ zoom: 0 }, clicked);
    const zeroDuration = optionsFor({ duration: 0 }, clicked);

    // Both are meaningful (whole-world view; instant jump) and both are falsy,
    // so a truthiness guard would silently discard them.
    expect(zeroZoom.zoom).toBe(0);
    expect(zeroDuration.duration).toBe(0);
    expect(() => LngLat.convert(zeroZoom.center as any)).not.toThrow();
  });

  it("omits unset options so MapLibre's own defaults apply", () => {
    const options = optionsFor({}, clicked);

    expect(Object.keys(options)).toEqual(["center"]);
  });
});
