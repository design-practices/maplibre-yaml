/**
 * @file The story engine re-applies its active chapter's layers on a map update (live documents, U6)
 * @module @maplibre-yaml/core/tests/scrollytelling
 *
 * @description
 * `<ml-scrollytelling>` re-sets the inner map's `config` on every story
 * render, and the inner element now updates in place (0.10). The engine is a
 * host under R10: when an update ADDED or REPLACED layers, the active
 * chapter's `layers.show/hide` is run again so a layer the chapter hides
 * stays hidden (a replaced layer is a new layer object under the same id,
 * so it comes back visible too); a paint-only edit must not re-run the
 * chapter (no camera move, no actions).
 */
import { describe, it, expect } from "vitest";
import { createStoryController, watchMapUpdates, type StoryMap } from "../../src/scrollytelling";
import type { ScrollytellingBlock } from "../../src/schemas/scrollytelling.schema";

function fakeMap(layers: string[]) {
  const calls: Array<[string, ...unknown[]]> = [];
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const map: StoryMap = {
    flyTo: rec("flyTo"),
    easeTo: rec("easeTo"),
    jumpTo: rec("jumpTo"),
    fitBounds: rec("fitBounds"),
    rotateTo: rec("rotateTo"),
    getBearing: () => 0,
    getCenter: () => ({ lng: 0, lat: 0 }),
    getLayer: (id: string) => (layers.includes(id) ? { id } : undefined),
    setFilter: rec("setFilter"),
    setPaintProperty: rec("setPaintProperty"),
    setLayoutProperty: rec("setLayoutProperty"),
    once: rec("once"),
  };
  return { map, calls };
}

const story = (): ScrollytellingBlock =>
  ({
    type: "scrollytelling",
    id: "s",
    config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" },
    layers: [
      { id: "route", type: "line", source: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
      { id: "quakes", type: "circle", source: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
    ],
    chapters: [
      {
        id: "c1",
        title: "One",
        center: [1, 1],
        zoom: 3,
        layers: { hide: ["route"], show: ["quakes"] },
        onChapterEnter: [{ action: "setPaintProperty", layer: "quakes", property: "circle-color", value: "#f00" }],
      },
      { id: "c2", title: "Two", center: [2, 2], zoom: 4 },
    ],
  }) as unknown as ScrollytellingBlock;

const summary = (over: Record<string, unknown> = {}) => ({
  added: [],
  removed: [],
  moved: [],
  replaced: [],
  propertiesSet: [],
  sourcesReplaced: [],
  cameraMoved: false,
  rebuild: false,
  failures: [],
  ...over,
});

const applied = (target: EventTarget, over: Record<string, unknown>) =>
  target.dispatchEvent(new CustomEvent("ml-map:update-applied", { bubbles: true, detail: { summary: summary(over) } }));

describe("the engine's update listener", () => {
  it("a story edit that adds a layer the active chapter hides leaves it hidden after ml-map:update-applied", () => {
    const container = document.createElement("div");
    const { map, calls } = fakeMap(["route", "quakes"]);
    const controller = createStoryController(container, story(), map, { reducedMotion: () => true });
    const mapEl = document.createElement("div");
    const stop = watchMapUpdates(mapEl, controller);
    controller.activate("c1");
    expect(calls.filter((c) => c[0] === "setLayoutProperty")).toEqual([
      ["setLayoutProperty", "quakes", "visibility", "visible"],
      ["setLayoutProperty", "route", "visibility", "none"],
    ]);
    calls.length = 0;

    // The update (a story edit) re-added `route`: it came back visible.
    applied(mapEl, { added: ["route"] });
    expect(calls).toEqual([
      ["setLayoutProperty", "quakes", "visibility", "visible"],
      ["setLayoutProperty", "route", "visibility", "none"],
    ]);
    stop();
    applied(mapEl, { added: ["route"] });
    expect(calls).toHaveLength(2);
  });

  it("a paint-only story edit does not re-run the chapter", () => {
    const container = document.createElement("div");
    const { map, calls } = fakeMap(["route", "quakes"]);
    const controller = createStoryController(container, story(), map, { reducedMotion: () => true });
    const mapEl = document.createElement("div");
    watchMapUpdates(mapEl, controller);
    controller.activate("c1");
    calls.length = 0;
    applied(mapEl, { propertiesSet: [{ layerId: "route", property: "line-color" }] });
    expect(calls).toEqual([]);
  });

  it("a story edit that replaced a layer the active chapter hides leaves it hidden after ml-map:update-applied", () => {
    const container = document.createElement("div");
    const { map, calls } = fakeMap(["route", "quakes"]);
    const controller = createStoryController(container, story(), map, { reducedMotion: () => true });
    const mapEl = document.createElement("div");
    watchMapUpdates(mapEl, controller);
    controller.activate("c1");
    calls.length = 0;

    // The update replaced `route` in place (a `replaced`-only summary, no `added`): it came back visible.
    applied(mapEl, { replaced: ["route"], rebuild: true });
    expect(calls).toEqual([
      ["setLayoutProperty", "quakes", "visibility", "visible"],
      ["setLayoutProperty", "route", "visibility", "none"],
    ]);
  });

  it("only the layer visibility runs again: no camera move, no enter actions, no chapter event", () => {
    const container = document.createElement("div");
    const { map, calls } = fakeMap(["route", "quakes"]);
    const controller = createStoryController(container, story(), map, { reducedMotion: () => true });
    const mapEl = document.createElement("div");
    watchMapUpdates(mapEl, controller);
    let chapterEvents = 0;
    container.addEventListener("ml-scrollytelling:chapter", () => chapterEvents++);
    controller.activate("c1");
    expect(chapterEvents).toBe(1);
    calls.length = 0;
    applied(mapEl, { added: ["quakes"] });
    expect(calls.map((c) => c[0])).toEqual(["setLayoutProperty", "setLayoutProperty"]);
    expect(chapterEvents).toBe(1);
  });

  it("with no active chapter, or before the map is set, an update does nothing", () => {
    const container = document.createElement("div");
    const { map, calls } = fakeMap(["route", "quakes"]);
    const controller = createStoryController(container, story(), null, { reducedMotion: () => true });
    const mapEl = document.createElement("div");
    watchMapUpdates(mapEl, controller);
    applied(mapEl, { added: ["route"] });
    controller.activate("c1");
    applied(mapEl, { added: ["route"] });
    expect(calls).toEqual([]);
    controller.setMap(map);
    calls.length = 0;
    applied(mapEl, { added: ["route"] });
    expect(calls.filter((c) => c[0] === "setLayoutProperty")).toHaveLength(2);
  });
});
