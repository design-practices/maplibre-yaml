/**
 * @file `<ml-map>` auto-attaches registered effects (U13′, experimental)
 *
 * @description
 * Core never imports @maplibre-yaml/effects; the element reads the effects
 * host hook. These pin the lifecycle: attach after the document loads,
 * detach on reload and on removal, late host registration still attaches,
 * and a document without `effect:` never touches the hook.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("maplibre-gl", () => ({ default: {}, Map: vi.fn(), Popup: vi.fn() }));

/** Renderers the mock created, with their captured `on()` handlers. */
const renderers: Array<{ handlers: Record<string, Array<() => void>>; map: object; destroyed: boolean }> = [];

vi.mock("../../src/renderer/map-renderer", () => ({
  MapRenderer: vi.fn().mockImplementation(() => {
    const r = {
      handlers: {} as Record<string, Array<() => void>>,
      map: { id: renderers.length },
      destroyed: false,
      getMap() {
        return r.destroyed ? null : r.map;
      },
      on(event: string, cb: () => void) {
        (r.handlers[event] ??= []).push(cb);
      },
      destroy() {
        r.destroyed = true;
      },
      isMapLoaded: () => true,
    };
    renderers.push(r);
    return r;
  }),
}));

import { MLMap } from "../../src/components/ml-map";
import {
  registerEffectsHost,
  resetEffectsHostForTests,
  type EffectsHost,
} from "../../src/effects-host";

const DOC = (effect: boolean) =>
  JSON.stringify({
    type: "map",
    id: "fx",
    config: { mapStyle: "https://example.com/style.json", center: [0, 0], zoom: 15 },
    sources: { omt: { type: "vector", tiles: ["https://example.com/{z}/{x}/{y}.pbf"] } },
    layers: [
      {
        id: "buildings",
        type: "fill-extrusion",
        source: "omt",
        "source-layer": "building",
        paint: { "fill-extrusion-height": 10 },
        ...(effect ? { effect: { type: "tonal-hatch", gain: 0.5 } } : {}),
      },
    ],
  });

function spyHost() {
  const calls = { attach: [] as unknown[][], detach: 0 };
  const host: EffectsHost = {
    apiVersion: 1,
    types: () => ["tonal-hatch"],
    validate: () => [],
    attach(map, layers) {
      calls.attach.push([map, layers]);
      return { detach: () => void calls.detach++ };
    },
    lower: (_e, l) => l,
  };
  return { host, calls };
}

const fireLoad = (i: number) => renderers[i]!.handlers["load"]?.forEach((cb) => cb());

async function mount(effect: boolean): Promise<MLMap> {
  const el = document.createElement("ml-map") as MLMap;
  el.setAttribute("config", DOC(effect));
  document.body.appendChild(el);
  await new Promise((r) => setTimeout(r, 0));
  return el;
}

describe("<ml-map> effects auto-attach", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    renderers.length = 0;
    if (!customElements.get("ml-map")) customElements.define("ml-map", MLMap);
  });
  afterEach(() => {
    resetEffectsHostForTests();
  });

  it("attaches after the document loads, with the effect layers, and detaches on removal", async () => {
    const { host, calls } = spyHost();
    registerEffectsHost(host);
    const el = await mount(true);
    expect(calls.attach).toHaveLength(0); // not before load
    fireLoad(0);
    expect(calls.attach).toHaveLength(1);
    expect(calls.attach[0]![0]).toBe(renderers[0]!.map);
    expect(calls.attach[0]![1]).toEqual([
      { layerId: "buildings", effect: { type: "tonal-hatch", gain: 0.5 } },
    ]);
    el.remove();
    expect(calls.detach).toBe(1);
  });

  it("detaches before re-rendering on reload, then attaches to the new map", async () => {
    const { host, calls } = spyHost();
    registerEffectsHost(host);
    const el = await mount(true);
    fireLoad(0);
    el.setAttribute("config", DOC(true).replace('"gain":0.5', '"gain":0.6'));
    (el as unknown as { applyValidatedConfig(c: unknown): void }).applyValidatedConfig(
      JSON.parse(DOC(true).replace('"gain":0.5', '"gain":0.6'))
    );
    expect(calls.detach).toBe(1);
    const second = renderers.length - 1;
    fireLoad(second);
    expect(calls.attach).toHaveLength(2);
    expect(calls.attach[1]![0]).toBe(renderers[second]!.map);
  });

  it("a host registered after load still attaches; without one the layers stay static and it says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const el = await mount(true);
    fireLoad(0);
    expect(warn.mock.calls.some((c) => /@maplibre-yaml\/effects is not loaded/.test(String(c[0])))).toBe(true);
    const { host, calls } = spyHost();
    registerEffectsHost(host);
    expect(calls.attach).toHaveLength(1);
    el.remove();
    expect(calls.detach).toBe(1);
    warn.mockRestore();
  });

  it("a document without effect: never reaches the hook", async () => {
    const { host, calls } = spyHost();
    registerEffectsHost(host);
    await mount(false);
    fireLoad(0);
    expect(calls.attach).toHaveLength(0);
    expect(renderers[0]!.handlers["load"]?.length ?? 0).toBeLessThanOrEqual(1);
  });
});
