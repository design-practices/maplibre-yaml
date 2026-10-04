/**
 * @file maplibre-interop: raw-UMD fallback
 *
 * @description
 * When a browser loads maplibre-gl's UMD file as an ES module without a
 * bundler's CJS interop (Vite dev, when maplibre-gl was never pre-bundled
 * because only a dependency's `.astro` component imports it), the module
 * namespace is empty and the UMD has assigned `globalThis.maplibregl`
 * instead. Every `@maplibre-yaml/astro` component then failed under
 * `astro dev` with "Map is not a constructor". This pins the fallback.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// Vitest mocks throw on any key the factory does not name, so spell out every
// binding the interop module reads, defaulting to absent.
const namespace = (bindings: Record<string, unknown> = {}) => ({
  default: undefined,
  Map: undefined,
  Popup: undefined,
  Marker: undefined,
  NavigationControl: undefined,
  GeolocateControl: undefined,
  ScaleControl: undefined,
  FullscreenControl: undefined,
  AttributionControl: undefined,
  addProtocol: undefined,
  removeProtocol: undefined,
  ...bindings,
});

describe("maplibre-interop with an empty namespace (raw UMD)", () => {
  afterEach(() => {
    delete (globalThis as { maplibregl?: unknown }).maplibregl;
    vi.doUnmock("maplibre-gl");
    vi.resetModules();
  });

  it("resolves constructors from globalThis.maplibregl", async () => {
    class FakeMap {}
    const addProtocol = () => {};
    (globalThis as { maplibregl?: unknown }).maplibregl = {
      Map: FakeMap,
      addProtocol,
    };
    vi.resetModules();
    // Raw UMD as ESM: no bindings at all.
    vi.doMock("maplibre-gl", () => namespace());

    const interop = await import("../../src/renderer/maplibre-interop");

    expect(interop.Map).toBe(FakeMap);
    expect(interop.addProtocol).toBe(addProtocol);
  });

  it("still prefers the module's own bindings when it has them", async () => {
    class ModuleMap {}
    class GlobalMap {}
    (globalThis as { maplibregl?: unknown }).maplibregl = { Map: GlobalMap };
    vi.resetModules();
    vi.doMock("maplibre-gl", () => namespace({ Map: ModuleMap }));

    const interop = await import("../../src/renderer/maplibre-interop");

    expect(interop.Map).toBe(ModuleMap);
  });
});
