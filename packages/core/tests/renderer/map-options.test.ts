/**
 * @file Map options with a runtime floor (ml-vwz, MapLibre 6.13–6.18 parity)
 * @module @maplibre-yaml/core/tests/renderer
 *
 * @description
 * Three `config:` map options gained a shape in maplibre-gl 6.x that the
 * library mirrors verbatim and degrades below the release that introduced
 * it, with one notice (the declared-absence posture):
 *
 * - `dragRotate: { around: 'pointer' }` / `{ around: 'center', movement }`
 *   (6.15): below the floor the map still rotates (`true`).
 * - `maxBounds` with an open longitude, `[-Infinity, south, Infinity, north]`
 *   (6.16, `setMaxBounds`): below the floor the longitude closes at ±180 so
 *   the latitude limit still holds (an infinite longitude breaks the
 *   constrain maths on older runtimes).
 * - `state:` defaults as the constructor's `globalState` (6.14), so the first
 *   frame already reads them; below the floor `setGlobalStateProperty`.
 */
import { describe, it, expect } from "vitest";
import {
  dragRotateForRuntime,
  maxBoundsForRuntime,
  globalStateForRuntime,
  hasOpenLongitude,
} from "../../src/renderer/map-options";
import {
  DRAG_ROTATE_OPTIONS_RUNTIME_FLOOR,
  MAX_BOUNDS_OPEN_LONGITUDE_RUNTIME_FLOOR,
  GLOBAL_STATE_OPTION_RUNTIME_FLOOR,
} from "../../src/capabilities";

describe("the floors", () => {
  it("name the releases that introduced each shape", () => {
    expect(DRAG_ROTATE_OPTIONS_RUNTIME_FLOOR).toBe("6.15.0");
    expect(MAX_BOUNDS_OPEN_LONGITUDE_RUNTIME_FLOOR).toBe("6.16.0");
    expect(GLOBAL_STATE_OPTION_RUNTIME_FLOOR).toBe("6.14.0");
  });
});

describe("dragRotate (6.15: DragRotateOptions)", () => {
  it("passes a boolean through on any runtime, without a notice", () => {
    for (const version of ["4.7.1", "6.12.0", "6.18.0", undefined]) {
      expect(dragRotateForRuntime(false, version)).toEqual({ value: false });
      expect(dragRotateForRuntime(true, version)).toEqual({ value: true });
    }
  });

  it("passes the options object through at and above the floor", () => {
    const pointer = { around: "pointer" as const };
    const linear = { around: "center" as const, movement: "linear" as const };
    expect(dragRotateForRuntime(pointer, "6.15.0")).toEqual({ value: pointer });
    expect(dragRotateForRuntime(linear, "6.18.0")).toEqual({ value: linear });
  });

  it("below the floor the map still rotates (true) and one notice names the floor", () => {
    const result = dragRotateForRuntime({ around: "pointer" }, "6.12.0");
    expect(result.value).toBe(true);
    expect(result.notice).toContain("dragRotate");
    expect(result.notice).toContain("6.15.0");
    expect(result.notice).toContain("6.12.0");
    // An unknown version is not a claim the floor is met.
    expect(dragRotateForRuntime({ around: "pointer" }, undefined).value).toBe(true);
  });

  it("undefined stays undefined (MapLibre's default)", () => {
    expect(dragRotateForRuntime(undefined, "6.18.0")).toEqual({ value: undefined });
  });
});

describe("maxBounds with an open longitude (6.16: setMaxBounds)", () => {
  it("recognises MapLibre's shape: west -Infinity and east Infinity together, in either bounds form", () => {
    expect(hasOpenLongitude([-Infinity, 40.5, Infinity, 40.9])).toBe(true);
    expect(hasOpenLongitude([[-Infinity, 40.5], [Infinity, 40.9]])).toBe(true);
    expect(hasOpenLongitude([-74.3, 40.5, -73.7, 40.9])).toBe(false);
    expect(hasOpenLongitude([[-74.3, 40.5], [-73.7, 40.9]])).toBe(false);
    expect(hasOpenLongitude(undefined)).toBe(false);
    expect(hasOpenLongitude(null)).toBe(false);
  });

  it("passes finite bounds through on any runtime, without a notice", () => {
    const flat = [-74.3, 40.5, -73.7, 40.9];
    expect(maxBoundsForRuntime(flat, "6.12.0")).toEqual({ value: flat });
    expect(maxBoundsForRuntime(flat, "6.18.0")).toEqual({ value: flat });
    expect(maxBoundsForRuntime(undefined, "6.12.0")).toEqual({ value: undefined });
    expect(maxBoundsForRuntime(null, "6.18.0")).toEqual({ value: null });
  });

  it("passes an open longitude through at and above the floor", () => {
    const open = [-Infinity, 40.5, Infinity, 40.9];
    expect(maxBoundsForRuntime(open, "6.16.0")).toEqual({ value: open });
    const corners = [[-Infinity, 40.5], [Infinity, 40.9]];
    expect(maxBoundsForRuntime(corners, "6.18.0")).toEqual({ value: corners });
  });

  it("below the floor the longitude closes at ±180 (the latitude limit holds) and one notice names the floor", () => {
    const flat = maxBoundsForRuntime([-Infinity, 40.5, Infinity, 40.9], "6.12.0");
    expect(flat.value).toEqual([-180, 40.5, 180, 40.9]);
    expect(flat.notice).toContain("maxBounds");
    expect(flat.notice).toContain("6.16.0");
    expect(flat.notice).toContain("6.12.0");
    // The corner form closes to the same flat bounds (MapLibre takes either).
    const corners = maxBoundsForRuntime([[-Infinity, -60], [Infinity, 60]], "5.6.0");
    expect(corners.value).toEqual([-180, -60, 180, 60]);
    expect(corners.notice).toBeDefined();
    expect(maxBoundsForRuntime([-Infinity, 40.5, Infinity, 40.9], undefined).value).toEqual([-180, 40.5, 180, 40.9]);
  });
});

describe("state: defaults at construction (6.14: MapOptions.globalState)", () => {
  const state = { year: { default: 2010 }, region: { default: "north" }, empty: {} };

  it("at and above the floor, the defaults become the constructor's globalState", () => {
    expect(globalStateForRuntime(state, "6.14.0")).toEqual({ year: 2010, region: "north" });
    expect(globalStateForRuntime(state, "6.18.0")).toEqual({ year: 2010, region: "north" });
  });

  it("below the floor, or on an unknown runtime, nothing (the setter path applies them on load)", () => {
    expect(globalStateForRuntime(state, "6.13.2")).toBeUndefined();
    expect(globalStateForRuntime(state, "5.6.0")).toBeUndefined();
    expect(globalStateForRuntime(state, undefined)).toBeUndefined();
  });

  it("no state, or no defaults, is nothing on any runtime", () => {
    expect(globalStateForRuntime(undefined, "6.18.0")).toBeUndefined();
    expect(globalStateForRuntime({}, "6.18.0")).toBeUndefined();
    expect(globalStateForRuntime({ empty: {} }, "6.18.0")).toBeUndefined();
  });
});
