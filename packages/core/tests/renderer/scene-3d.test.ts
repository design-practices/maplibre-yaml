/**
 * @file Map-level 3D setters (U15): feature-detected, one warning per absence
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  applyProjection,
  applySky,
  applyTerrain,
} from "../../src/renderer/scene-3d";

afterEach(() => {
  vi.restoreAllMocks();
});

const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => {});

describe("applyProjection", () => {
  it("calls setProjection with the spec shape when the runtime has it (>= 5.0)", () => {
    const map = { setProjection: vi.fn() };
    expect(applyProjection(map, { type: "globe" })).toBe(true);
    expect(map.setProjection).toHaveBeenCalledWith({ type: "globe" });
  });

  it("globe on a runtime without setProjection warns once, naming the 5.0.0 floor", () => {
    const warn = quiet();
    expect(applyProjection({}, { type: "globe" })).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/5\.0\.0.*mercator/);
  });

  it("mercator on a runtime without setProjection is already true — no warning", () => {
    const warn = quiet();
    expect(applyProjection({}, { type: "mercator" })).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("a throwing setter degrades to a warning, never a throw", () => {
    const warn = quiet();
    const map = {
      setProjection: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    expect(applyProjection(map, { type: "globe" })).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("applySky", () => {
  it("hands the authored sky to setSky (>= 4.5)", () => {
    const map = { setSky: vi.fn() };
    const sky = { "sky-color": "#00f", "fog-ground-blend": 0.1 };
    expect(applySky(map, sky)).toBe(true);
    expect(map.setSky).toHaveBeenCalledWith(sky);
  });

  it("a runtime without setSky warns once, naming the 4.5.0 floor", () => {
    const warn = quiet();
    expect(applySky({}, { "sky-color": "#00f" })).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("4.5.0");
  });
});

describe("applyTerrain", () => {
  const dem = () => ({ type: "raster-dem" });

  it("applies when the named source is a raster-dem", () => {
    const map = { setTerrain: vi.fn(), getSource: vi.fn(dem) };
    expect(applyTerrain(map, { source: "dem", exaggeration: 2 }, false)).toBe("applied");
    expect(map.setTerrain).toHaveBeenCalledWith({ source: "dem", exaggeration: 2 });
  });

  it("omits exaggeration when unauthored (the spec default applies)", () => {
    const map = { setTerrain: vi.fn(), getSource: vi.fn(dem) };
    applyTerrain(map, { source: "dem" }, false);
    expect(map.setTerrain).toHaveBeenCalledWith({ source: "dem" });
  });

  it("a missing source is silently pending on the first attempt, a warning on the final one", () => {
    const warn = quiet();
    const map = { setTerrain: vi.fn(), getSource: vi.fn(() => undefined) };
    expect(applyTerrain(map, { source: "dem" }, false)).toBe("pending");
    expect(warn).not.toHaveBeenCalled();
    expect(applyTerrain(map, { source: "dem" }, true)).toBe("failed");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(map.setTerrain).not.toHaveBeenCalled();
  });

  it("refuses a non-DEM source with a warning instead of a MapLibre error", () => {
    const warn = quiet();
    const map = { setTerrain: vi.fn(), getSource: vi.fn(() => ({ type: "raster" })) };
    expect(applyTerrain(map, { source: "sat" }, false)).toBe("failed");
    expect(String(warn.mock.calls[0]![0])).toContain("raster-dem");
    expect(map.setTerrain).not.toHaveBeenCalled();
  });

  it("a runtime without setTerrain warns once, naming the 2.2.0 floor", () => {
    const warn = quiet();
    expect(applyTerrain({}, { source: "dem" }, false)).toBe("failed");
    expect(String(warn.mock.calls[0]![0])).toContain("2.2.0");
  });
});
