/**
 * @file The Scrollytelling browser controller, against a recording fake map
 *
 * @description
 * ml-97k: `ChapterActionSchema` accepted flyTo / easeTo / fitBounds / custom,
 * and the controller silently ignored all four. Every action the schema
 * accepts must now reach the map (or, for `custom`, the page).
 */

import { describe, it, expect, vi } from "vitest";

// `CustomEvent` is a Node global only from Node 22; CI also runs Node 18 and
// 20, where `Event`/`EventTarget` exist but `CustomEvent` does not. The
// client script calls it at runtime (in browsers it always exists), so a
// minimal polyfill here is enough for the node test environment.
if (typeof globalThis.CustomEvent === "undefined") {
  class NodeCustomEvent<T> extends Event {
    readonly detail: T;
    constructor(type: string, init?: CustomEventInit<T>) {
      super(type, init);
      this.detail = init?.detail as T;
    }
  }
  (globalThis as { CustomEvent?: unknown }).CustomEvent = NodeCustomEvent;
}
import {
  runChapterAction,
  createStoryController,
  storyMapDocument,
  safeMediaSrc,
  escapeHtml,
  ACTION_EVENT,
  CHAPTER_EVENT,
  type StoryMap,
} from "../../src/client/scrollytelling";
import { ChapterActionSchema, ScrollytellingBlockSchema } from "@maplibre-yaml/core/schemas";

function fakeMap(layers: string[] = ["quakes"]) {
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

function fakeContainer() {
  const target = new EventTarget() as EventTarget & {
    dataset: Record<string, string>;
    querySelectorAll: () => never[];
  };
  target.dataset = {};
  target.querySelectorAll = () => [];
  return target as unknown as HTMLElement;
}

const ctx = () => ({ container: fakeContainer(), chapterId: "c1", phase: "enter" as const });

describe("runChapterAction covers every action the schema accepts", () => {
  const actions = (ChapterActionSchema.shape.action as { options: string[] }).options;

  it("the schema's action list is the one this suite covers", () => {
    expect([...actions].sort()).toEqual(
      ["custom", "easeTo", "fitBounds", "flyTo", "setFilter", "setLayoutProperty", "setPaintProperty"].sort()
    );
  });

  it("setFilter / setPaintProperty / setLayoutProperty reach the layer", () => {
    const { map, calls } = fakeMap();
    runChapterAction(map, { action: "setFilter", layer: "quakes", filter: [">=", ["get", "mag"], 5] }, ctx());
    runChapterAction(map, { action: "setPaintProperty", layer: "quakes", property: "circle-color", value: "#f00" }, ctx());
    runChapterAction(map, { action: "setLayoutProperty", layer: "quakes", property: "visibility", value: "none" }, ctx());
    expect(calls).toEqual([
      ["setFilter", "quakes", [">=", ["get", "mag"], 5]],
      ["setPaintProperty", "quakes", "circle-color", "#f00"],
      ["setLayoutProperty", "quakes", "visibility", "none"],
    ]);
  });

  it("a layer action on a missing layer warns instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { map, calls } = fakeMap([]);
    runChapterAction(map, { action: "setFilter", layer: "nope", filter: null }, ctx());
    expect(calls).toEqual([]);
    expect(String(warn.mock.calls[0][0])).toContain('no layer "nope"');
    warn.mockRestore();
  });

  it("flyTo / easeTo take their camera from options", () => {
    const { map, calls } = fakeMap();
    runChapterAction(map, { action: "flyTo", options: { center: [1, 2], zoom: 5 } }, ctx());
    runChapterAction(map, { action: "easeTo", options: { bearing: 30, duration: 500 } }, ctx());
    expect(calls).toEqual([
      ["flyTo", { center: [1, 2], zoom: 5 }],
      ["easeTo", { bearing: 30, duration: 500 }],
    ]);
  });

  it("fitBounds turns [w, s, e, n] into a LngLatBounds pair", () => {
    const { map, calls } = fakeMap();
    runChapterAction(map, { action: "fitBounds", bounds: [-74.3, 40.5, -73.7, 40.9], options: { padding: 50 } }, ctx());
    expect(calls).toEqual([["fitBounds", [[-74.3, 40.5], [-73.7, 40.9]], { padding: 50 }]]);
  });

  it("custom dispatches ml-scrollytelling:action with the action and phase", () => {
    const { map } = fakeMap();
    const c = ctx();
    const seen: CustomEvent[] = [];
    c.container.addEventListener(ACTION_EVENT, (e) => seen.push(e as CustomEvent));
    runChapterAction(map, { action: "custom", options: { name: "pulse" } }, c);
    expect(seen).toHaveLength(1);
    expect(seen[0].detail).toMatchObject({ chapterId: "c1", phase: "enter", action: { options: { name: "pulse" } } });
    expect(seen[0].detail.map).toBe(map);
  });
});

describe("createStoryController", () => {
  const story = ScrollytellingBlockSchema.parse({
    type: "scrollytelling",
    id: "s",
    config: { center: [0, 0], zoom: 1, mapStyle: "https://x/style.json" },
    layers: [],
    chapters: [
      {
        id: "a",
        title: "A",
        center: [10, 20],
        zoom: 4,
        layers: { show: ["quakes"] },
        onChapterExit: [{ action: "setPaintProperty", layer: "quakes", property: "circle-color", value: "#000" }],
      },
      {
        id: "b",
        title: "B",
        center: [30, 40],
        zoom: 6,
        animation: "jumpTo",
        callback: "onB",
        layers: { hide: ["quakes"] },
        onChapterEnter: [{ action: "fitBounds", bounds: [0, 0, 1, 1] }],
      },
    ],
  });

  it("moves the camera, toggles layers, runs exit then enter actions, and announces the chapter", () => {
    const { map, calls } = fakeMap();
    const container = fakeContainer();
    const events: CustomEvent[] = [];
    container.addEventListener(CHAPTER_EVENT, (e) => events.push(e as CustomEvent));
    const controller = createStoryController(container, story, map);

    controller.activate("a");
    expect(calls[0][0]).toBe("flyTo");
    expect(calls[0][1]).toMatchObject({ center: [10, 20], zoom: 4 });
    expect(calls).toContainEqual(["setLayoutProperty", "quakes", "visibility", "visible"]);
    expect(container.dataset.activeChapter).toBe("a");

    calls.length = 0;
    controller.activate("b");
    expect(calls.map((c) => c[0])).toEqual(["setPaintProperty", "jumpTo", "setLayoutProperty", "fitBounds"]);
    expect(events.map((e) => e.detail.chapterId)).toEqual(["a", "b"]);
    expect(events[1].detail).toMatchObject({ previousChapterId: "a", index: 1, callback: "onB" });

    // Re-activating the active chapter is a no-op.
    calls.length = 0;
    controller.activate("b");
    expect(calls).toEqual([]);
  });

  it("rotateAnimation starts after the chapter's transition (moveend)", () => {
    const { map, calls } = fakeMap();
    const spinning = { ...story, chapters: [{ ...story.chapters[0], rotateAnimation: true }] };
    createStoryController(fakeContainer(), spinning, map).activate("a");
    expect(calls.some((c) => c[0] === "once" && c[1] === "moveend")).toBe(true);
  });
});

describe("helpers", () => {
  it("storyMapDocument is the map half of a story", () => {
    expect(
      storyMapDocument({ id: "s", config: { center: [0, 0], zoom: 1 } as never, layers: undefined as never })
    ).toEqual({ type: "map", id: "s-map", config: { center: [0, 0], zoom: 1 }, layers: [] });
  });

  it("safeMediaSrc keeps relative/http(s) and drops script-ish schemes", () => {
    expect(safeMediaSrc("/img/a.png")).toBe("/img/a.png");
    expect(safeMediaSrc("https://x/a.png")).toBe("https://x/a.png");
    expect(safeMediaSrc("javascript:alert(1)")).toBeNull();
    expect(safeMediaSrc("data:image/png;base64,xx")).toBeNull();
  });

  it("escapeHtml escapes the five specials", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
