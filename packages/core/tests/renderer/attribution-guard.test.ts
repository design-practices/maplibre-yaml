/**
 * The attribution guard against MapLibre's REAL AttributionControl.
 *
 * @remarks
 * The claim under test is about ordering: attribution a document *points at*
 * (a remote basemap style, a TileJSON) lands on a source object inside
 * MapLibre after load, and the control re-renders it as HTML from its own
 * `sourcedata` listener. The guard must rewrite it first. A mocked control
 * cannot prove that, so this drives the genuine one over a minimal map whose
 * event dispatch follows MapLibre's rule (listeners in registration order).
 */
import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  const w = globalThis as any;
  w.URL.createObjectURL ??= () => "blob:guard";
  w.URL.revokeObjectURL ??= () => {};
  w.Worker ??= class {
    postMessage() {}
    terminate() {}
    addEventListener() {}
  };
});

import { AttributionControl } from "maplibre-gl";
import { installAttributionGuard } from "../../src/renderer/attribution-guard";

function stubMap() {
  const listeners = new Map<string, Function[]>();
  const sources: Record<string, { attribution?: unknown }> = {};
  const registry: Record<string, unknown> = {};
  const map: any = {
    on(type: string, fn: Function) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    off(type: string, fn: Function) {
      listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
    },
    fire(type: string, event: Record<string, unknown>) {
      for (const fn of listeners.get(type) ?? []) fn({ type, ...event });
    },
    listenerCount: (type: string) => (listeners.get(type) ?? []).length,
    _getUIString: (key: string) => key,
    getContainer: () => document.createElement("div"),
    getCanvasContainer: () => document.createElement("div"),
    // Both registry names MapLibre has used; the guard reads either.
    style: { stylesheet: {}, tileManagers: registry, sourceCaches: registry },
    addSource(id: string, attribution: unknown) {
      sources[id] = { attribution };
      registry[id] = { used: true, usedForTerrain: false, getSource: () => sources[id] };
    },
    sources,
  };
  return map;
}

/** Every element in rendered attribution is a link with only safe attributes. */
function assertOnlySafeLinks(container: HTMLElement) {
  for (const element of Array.from(container.querySelectorAll("*"))) {
    expect(element.tagName).toBe("A");
    for (const attr of Array.from(element.attributes)) {
      expect(["href", "target", "rel"]).toContain(attr.name);
    }
    expect(element.getAttribute("href")).toMatch(/^(https?|mailto):/);
  }
}

const HOSTILE =
  '<img src="x" data-probe="1"><a href="https://ok.test/" data-probe="2">Data</a>';

describe("attribution guard", () => {
  it("is load-bearing: without it, the real control renders non-link markup", () => {
    const map = stubMap();
    const control = new AttributionControl({ compact: false });
    const element = control.onAdd(map) as HTMLElement;
    map.addSource("remote", HOSTILE);
    map.fire("sourcedata", { dataType: "source", sourceDataType: "metadata", sourceId: "remote" });
    // MapLibre's own sanitizer keeps the <img> and the data-* attributes —
    // the denylist this whole module exists to stand in front of.
    expect(element.querySelector(".maplibregl-ctrl-attrib-inner img")).not.toBeNull();
    control.onRemove();
  });

  it("rewrites attribution that arrives after load, before the control renders it", () => {
    const map = stubMap();
    installAttributionGuard(map);
    const control = new AttributionControl({ compact: false });
    const element = control.onAdd(map) as HTMLElement;

    // A TileJSON / remote style resolving: the attribution appears on the
    // source object, then MapLibre fires a metadata event.
    map.addSource("remote", HOSTILE);
    map.fire("sourcedata", { dataType: "source", sourceDataType: "metadata", sourceId: "remote" });

    const inner = element.querySelector(".maplibregl-ctrl-attrib-inner") as HTMLElement;
    expect(inner.textContent).toContain("Data");
    expect(inner.querySelector("a")?.getAttribute("href")).toBe("https://ok.test/");
    assertOnlySafeLinks(inner);
    expect(map.sources.remote.attribution).not.toContain("<img");

    control.onRemove();
  });

  it("also covers style loads (a remote basemap's sources)", () => {
    const map = stubMap();
    installAttributionGuard(map);
    const control = new AttributionControl({ compact: false });
    const element = control.onAdd(map) as HTMLElement;

    map.addSource("basemap", "<b>Basemap</b>");
    map.fire("styledata", { dataType: "style" });

    const inner = element.querySelector(".maplibregl-ctrl-attrib-inner") as HTMLElement;
    expect(inner.textContent).toBe("<b>Basemap</b>");
    assertOnlySafeLinks(inner);

    control.onRemove();
  });

  it("scrub() sanitizes synchronously for controls added after sources exist", () => {
    const map = stubMap();
    const guard = installAttributionGuard(map);
    map.addSource("doc", "<i>x</i>");
    guard.scrub();
    expect(map.sources.doc.attribution).toBe("&lt;i&gt;x&lt;/i&gt;");
  });

  it("leaves ordinary attribution, including MapLibre's default link, untouched", () => {
    const map = stubMap();
    const guard = installAttributionGuard(map);
    const osm =
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    map.addSource("osm", osm);
    guard.scrub();
    expect(map.sources.osm.attribution).toBe(osm);
  });

  it("dispose() removes every listener it added", () => {
    const map = stubMap();
    const guard = installAttributionGuard(map);
    expect(map.listenerCount("sourcedata")).toBe(1);
    guard.dispose();
    for (const type of ["styledata", "sourcedata", "terrain"]) {
      expect(map.listenerCount(type)).toBe(0);
    }
  });
});
