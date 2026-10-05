/**
 * @file `<ml-map>` config lifecycle (U21): ml-jh6, ml-mpm, ml-i10
 *
 * @description
 * How a config reaches the element when a framework (or a module script)
 * drives it: a property set BEFORE connect is validated and defaulted like
 * every other path (ml-jh6); an element that connects empty waits a task for
 * a programmatic config before reporting "No configuration provided", and a
 * property set before the element is even defined is not lost (ml-mpm); and
 * re-assigning a JSON-equal config does not rebuild the map (ml-i10).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("maplibre-gl", () => {
  const Map = vi.fn(() => ({ on: vi.fn(), off: vi.fn(), remove: vi.fn() }));
  return { default: { Map }, Map };
});

// The renderer double records its `on()` handlers so a test can fire `load`.
vi.mock("../../src/renderer/map-renderer", () => ({
  MapRenderer: vi.fn().mockImplementation((container, config, layers, options) => ({
    container,
    config,
    layers,
    options,
    handlers: new Map<string, (payload?: unknown) => void>(),
    getMap: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
    destroy: vi.fn(),
    on: vi.fn(function (this: any, name: string, fn: () => void) {
      this.handlers.set(name, fn);
    }),
  })),
}));

import { MLMap } from "../../src/components/ml-map";
import { MapRenderer } from "../../src/renderer/map-renderer";

const constructed = () =>
  vi.mocked(MapRenderer).mock.results.map((r) => r.value as any);

/** Let the deferred empty-config check (next frame + a task) and microtasks run. */
const settle = () => new Promise((r) => setTimeout(r, 60));

const validBlock = () => ({
  type: "map" as const,
  id: "m",
  config: {
    mapStyle: "https://demotiles.maplibre.org/style.json",
    center: [-74.5, 40] as [number, number],
    zoom: 9,
  },
  layers: [
    {
      id: "pts",
      type: "circle" as const,
      source: {
        type: "geojson" as const,
        data: { type: "FeatureCollection" as const, features: [] },
      },
      paint: { "circle-radius": 4 } as Record<string, unknown>,
    },
  ],
});

const v2Block = () => ({
  version: 2 as const,
  type: "map" as const,
  id: "v2",
  style: {
    basemap: "https://demotiles.maplibre.org/style.json",
    center: [0, 0] as [number, number],
    zoom: 2,
    layers: [
      {
        id: "v2-layer",
        type: "circle" as const,
        source: {
          type: "geojson" as const,
          data: { type: "FeatureCollection" as const, features: [] },
        },
      },
    ],
  },
});

function recordEvents(el: HTMLElement) {
  const events: { type: string; detail: any }[] = [];
  for (const type of ["ml-map:error", "ml-map:load"]) {
    el.addEventListener(type, (e) =>
      events.push({ type, detail: (e as CustomEvent).detail })
    );
  }
  return events;
}

beforeEach(() => {
  document.body.innerHTML = "";
  if (!customElements.get("ml-map")) customElements.define("ml-map", MLMap);
  vi.mocked(MapRenderer).mockClear();
});

describe("ml-jh6: a config property set before connect is validated", () => {
  it("shows the error card (not a renderer crash) for an invalid layer type", async () => {
    const el = document.createElement("ml-map") as MLMap;
    const events = recordEvents(el);
    el.config = { ...validBlock(), layers: [{ id: "bad", type: "nope" }] } as any;
    document.body.appendChild(el);
    await settle();

    expect(constructed()).toHaveLength(0);
    expect(el.querySelector(".ml-map-error")?.textContent).toMatch(/layers/);
    expect(events.map((e) => e.type)).toEqual(["ml-map:error"]);
    expect(events[0].detail.errors.length).toBeGreaterThan(0);
  });

  it("applies schema defaults before rendering", async () => {
    const el = document.createElement("ml-map") as MLMap;
    const { layers: _omit, ...noLayers } = validBlock();
    el.config = noLayers as any;
    document.body.appendChild(el);
    await settle();

    expect(constructed()).toHaveLength(1);
    // `layers` defaults to [] — only the validated document carries it.
    expect(el.config?.layers).toEqual([]);
  });

  it("logs unknown-key warnings, like the attribute path", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = document.createElement("ml-map") as MLMap;
    const block = validBlock();
    block.layers[0].paint = { "circle-radis": 4 };
    el.config = block as any;
    document.body.appendChild(el);
    await settle();

    expect(warn.mock.calls.map((c) => c.join(" ")).join("\n")).toContain(
      "circle-radis"
    );
    warn.mockRestore();
  });

  it.each([
    ["v1", validBlock],
    ["v2", v2Block],
  ])(
    "re-validating an already-validated %s document is idempotent",
    async (_label, make) => {
      const el = document.createElement("ml-map") as MLMap;
      el.config = make() as any;
      document.body.appendChild(el);
      await settle();
      expect(constructed()).toHaveLength(1);
      expect(el.querySelector(".ml-map-error")).toBeNull();

      // Round-trip the validated output back through the setter.
      el.config = JSON.parse(JSON.stringify(el.config));
      await settle();
      expect(el.querySelector(".ml-map-error")).toBeNull();
      expect(el.getRenderer()).toBeTruthy();
    }
  );
});

describe("ml-mpm: no false 'No configuration provided'", () => {
  it("config assigned right after connect: no error event, no card", async () => {
    const el = document.createElement("ml-map") as MLMap;
    const events = recordEvents(el);
    document.body.appendChild(el);
    el.config = validBlock() as any;
    await settle();

    expect(events.filter((e) => e.type === "ml-map:error")).toEqual([]);
    expect(el.querySelector(".ml-map-error")).toBeNull();
    expect(constructed()).toHaveLength(1);
  });

  it("config assigned in a later microtask: still no error", async () => {
    const el = document.createElement("ml-map") as MLMap;
    const events = recordEvents(el);
    document.body.appendChild(el);
    await Promise.resolve();
    await Promise.resolve();
    el.config = JSON.stringify(validBlock());
    await settle();

    expect(events.filter((e) => e.type === "ml-map:error")).toEqual([]);
    expect(constructed()).toHaveLength(1);
  });

  it("mapReady() called before the late config waits, then resolves", async () => {
    const el = document.createElement("ml-map") as MLMap;
    document.body.appendChild(el);
    const ready = el.mapReady();
    el.config = validBlock() as any;
    await settle();

    constructed()[0].handlers.get("load")();
    await expect(ready).resolves.toBeTruthy();
  });

  it("a genuinely empty element still reports the error, once, after a task", async () => {
    const el = document.createElement("ml-map") as MLMap;
    const events = recordEvents(el);
    document.body.appendChild(el);

    // Not synchronously: a module script may still be about to assign.
    expect(el.querySelector(".ml-map-error")).toBeNull();
    await settle();

    expect(events.map((e) => e.type)).toEqual(["ml-map:error"]);
    expect(events[0].detail.errors[0].message).toBe("No configuration provided.");
    expect(el.querySelector(".ml-map-error")).toBeTruthy();
    await expect(el.mapReady()).rejects.toThrow(/No configuration provided/);
  });

  it("a config arriving after the error replaces the card with the map", async () => {
    const el = document.createElement("ml-map") as MLMap;
    document.body.appendChild(el);
    await settle();
    expect(el.querySelector(".ml-map-error")).toBeTruthy();

    el.config = validBlock() as any;
    await settle();
    expect(el.querySelector(".ml-map-error")).toBeNull();
    expect(el.getRenderer()).toBeTruthy();
  });

  it("removing the element before the check fires cancels it", async () => {
    const el = document.createElement("ml-map") as MLMap;
    const events = recordEvents(el);
    document.body.appendChild(el);
    el.remove();
    await settle();
    expect(events).toEqual([]);
  });

  it("a .config set before the element is defined is not shadowed (upgrade)", async () => {
    const tag = "ml-map-upgrade-test";
    const el = document.createElement(tag) as MLMap;
    // The tag is not defined yet: this lands as a plain own property.
    (el as any).config = validBlock();
    document.body.appendChild(el);

    class UpgradeTest extends MLMap {}
    customElements.define(tag, UpgradeTest);
    await settle();

    expect(Object.prototype.hasOwnProperty.call(el, "config")).toBe(false);
    expect(el.querySelector(".ml-map-error")).toBeNull();
    expect(constructed()).toHaveLength(1);
    expect(el.config?.id).toBe("m");
  });
});

describe("ml-i10: an equal config does not rebuild the map", () => {
  const mounted = async (initial: unknown) => {
    const el = document.createElement("ml-map") as MLMap;
    el.config = initial as any;
    document.body.appendChild(el);
    await settle();
    expect(constructed()).toHaveLength(1);
    return el;
  };

  it("a new but deep-equal object is a no-op", async () => {
    const el = await mounted(validBlock());
    const first = el.getRenderer();

    el.config = validBlock() as any;
    el.config = validBlock() as any;
    await settle();

    expect(constructed()).toHaveLength(1);
    expect(el.getRenderer()).toBe(first);
    expect((first as any).destroy).not.toHaveBeenCalled();
  });

  it("the same document as a JSON string is a no-op", async () => {
    const el = await mounted(validBlock());
    el.config = JSON.stringify(validBlock());
    await settle();
    expect(constructed()).toHaveLength(1);
  });

  it("an equal property after the JSON attribute is a no-op", async () => {
    const el = document.createElement("ml-map") as MLMap;
    el.setAttribute("config", JSON.stringify(validBlock()));
    document.body.appendChild(el);
    await settle();
    expect(constructed()).toHaveLength(1);

    el.config = validBlock() as any;
    await settle();
    expect(constructed()).toHaveLength(1);
  });

  it("a changed document rebuilds", async () => {
    const el = await mounted(validBlock());
    el.config = { ...validBlock(), config: { ...validBlock().config, zoom: 4 } } as any;
    await settle();
    expect(constructed()).toHaveLength(2);
    expect(constructed()[0].destroy).toHaveBeenCalled();
  });

  it("the same object mutated in place and re-assigned rebuilds", async () => {
    const doc = validBlock();
    const el = await mounted(doc);
    doc.config.zoom = 3;
    el.config = doc as any;
    await settle();
    expect(constructed()).toHaveLength(2);
  });

  it("an equal config after null re-renders (null forgets the applied value)", async () => {
    const el = await mounted(validBlock());
    el.config = null;
    el.config = validBlock() as any;
    await settle();
    expect(constructed()).toHaveLength(2);
  });
});
