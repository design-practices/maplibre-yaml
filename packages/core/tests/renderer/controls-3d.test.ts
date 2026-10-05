/**
 * @file `controls.globe` / `controls.terrain` (U15) — feature-detected toggles
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// vi.mock is hoisted above plain declarations — the spies must be too.
const { GlobeControl, TerrainControl } = vi.hoisted(() => ({
  GlobeControl: vi.fn(() => ({ type: "globe" })),
  TerrainControl: vi.fn((options: unknown) => ({ type: "terrain", options })),
}));

vi.mock("maplibre-gl", () => {
  const ns = { GlobeControl, TerrainControl };
  return { default: ns, ...ns };
});

afterEach(() => {
  // Only the console spies are restored — restoring the hoisted control
  // spies would strip their implementations.
  vi.mocked(console.warn).mockRestore?.();
  TerrainControl.mockClear();
  GlobeControl.mockClear();
});

const mockMap = () => ({ addControl: vi.fn(), removeControl: vi.fn() });

describe("3D toggle controls on a v5-shaped runtime", () => {
  it("adds GlobeControl where declared", async () => {
    const { ControlsManager } = await import("../../src/renderer/controls-manager");
    const map = mockMap();
    new ControlsManager(map as never).addControls({ globe: { enabled: true, position: "top-left" } } as never);
    expect(map.addControl).toHaveBeenCalledWith(
      expect.objectContaining({ type: "globe" }),
      "top-left"
    );
  });

  it("TerrainControl toggles the document's own terrain (source + exaggeration)", async () => {
    const { ControlsManager } = await import("../../src/renderer/controls-manager");
    const map = mockMap();
    new ControlsManager(map as never, {
      terrain: { source: "dem", exaggeration: 1.5 },
    }).addControls({ terrain: true } as never);
    expect(TerrainControl).toHaveBeenCalledWith({ source: "dem", exaggeration: 1.5 });
    expect(map.addControl).toHaveBeenCalledWith(
      expect.objectContaining({ type: "terrain" }),
      "top-right"
    );
  });

  it("controls.terrain without a document terrain: warns, adds nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ControlsManager } = await import("../../src/renderer/controls-manager");
    const map = mockMap();
    new ControlsManager(map as never).addControls({ terrain: true } as never);
    expect(map.addControl).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("3D toggle controls on a 4.x-shaped runtime (no GlobeControl)", () => {
  it("controls.globe declares the absence with one warning instead of throwing", async () => {
    vi.resetModules();
    vi.doMock("maplibre-gl", () => {
      const ns = { TerrainControl };
      return { default: ns, ...ns };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ControlsManager } = await import("../../src/renderer/controls-manager");
    const map = mockMap();
    expect(() =>
      new ControlsManager(map as never).addControls({ globe: true } as never)
    ).not.toThrow();
    expect(map.addControl).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("5.0.0");
  });
});
