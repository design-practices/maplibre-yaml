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

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

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
  // U15 3D toggles (possibly absent on older runtimes) and U14's version probe.
  GlobeControl: undefined,
  TerrainControl: undefined,
  getVersion: undefined,
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

describe("maplibre-interop on maplibre-gl 6 (ESM-only, no default export)", () => {
  afterEach(() => {
    vi.doUnmock("maplibre-gl");
    vi.resetModules();
  });

  it("resolves the named bindings and the runtime version", async () => {
    class V6Map {}
    vi.resetModules();
    vi.doMock("maplibre-gl", () => namespace({ Map: V6Map, getVersion: () => "6.12.0" }));

    const interop = await import("../../src/renderer/maplibre-interop");

    expect(interop.Map).toBe(V6Map);
    expect(interop.runtimeVersion()).toBe("6.12.0");
  });
});

describe("setWorkerModuleUrl", () => {
  afterEach(() => {
    vi.doUnmock("maplibre-gl");
    vi.resetModules();
  });

  async function load(version: string, preset = "") {
    let workerUrl = preset;
    const setWorkerUrl = vi.fn((u: string) => {
      workerUrl = u;
    });
    vi.resetModules();
    vi.doMock("maplibre-gl", () =>
      namespace({
        Map: class {},
        getVersion: () => version,
        setWorkerUrl,
        getWorkerUrl: () => workerUrl,
      })
    );
    const interop = await import("../../src/renderer/maplibre-interop");
    return { interop, setWorkerUrl };
  }

  it("applies the worker module URL on maplibre-gl 6", async () => {
    const { interop, setWorkerUrl } = await load("6.12.0");
    expect(interop.setWorkerModuleUrl("/assets/maplibre-gl-worker-abc.mjs")).toBe(true);
    expect(setWorkerUrl).toHaveBeenCalledWith("/assets/maplibre-gl-worker-abc.mjs");
  });

  it("is a no-op before v6, without a URL, or when the host already set one", async () => {
    const v5 = await load("5.24.0");
    expect(v5.interop.setWorkerModuleUrl("/w.mjs")).toBe(false);
    expect(v5.setWorkerUrl).not.toHaveBeenCalled();
    const none = await load("6.12.0");
    expect(none.interop.setWorkerModuleUrl(undefined)).toBe(false);
    const hostSet = await load("6.12.0", "/host-worker.mjs");
    expect(hostSet.interop.setWorkerModuleUrl("/w.mjs")).toBe(false);
    expect(hostSet.setWorkerUrl).not.toHaveBeenCalled();
  });
});

describe("withWorkerUrlHint", () => {
  // A pure function, but its module imports maplibre-gl; never evaluate the
  // real bundle under jsdom (the v4/v5 UMD needs URL.createObjectURL).
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("maplibre-gl", () => namespace({ Map: class {} }));
  });
  afterEach(() => {
    vi.doUnmock("maplibre-gl");
    vi.resetModules();
  });

  it("tells a v6 bundler user how to fix a worker that failed to load", async () => {
    const { withWorkerUrlHint } = await import("../../src/renderer/maplibre-interop");
    const msg = "Worker failed to load. Check that the worker URL is correct.";
    const hinted = withWorkerUrlHint(msg, "6.12.0");
    expect(hinted.startsWith(msg)).toBe(true);
    expect(hinted).toMatch(/setWorkerUrl\(\)/);
    expect(hinted).toMatch(/maplibre-gl-worker\.mjs\?worker&url/);
  });

  it("leaves other errors, and pre-6 runtimes, unchanged", async () => {
    const { withWorkerUrlHint } = await import("../../src/renderer/maplibre-interop");
    expect(withWorkerUrlHint("Failed to fetch tile", "6.12.0")).toBe("Failed to fetch tile");
    expect(withWorkerUrlHint("Worker failed to load", "5.24.0")).toBe("Worker failed to load");
    expect(withWorkerUrlHint("Worker failed to load", undefined)).toBe("Worker failed to load");
  });
});
