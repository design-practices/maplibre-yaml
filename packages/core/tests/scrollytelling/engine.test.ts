/**
 * @file The scrollytelling engine, against a recording fake map
 *
 * @description
 * Moved from `@maplibre-yaml/astro` with the engine (ml-aot.1): one suite for
 * the one engine `<ml-scrollytelling>` and Astro's `<Scrollytelling>` share.
 *
 * ml-97k: `ChapterActionSchema` accepted flyTo / easeTo / fitBounds / custom,
 * and the old controller silently ignored all four. Every action the schema
 * accepts must reach the map (or, for `custom`, the page).
 */

import { describe, it, expect, vi } from "vitest";
import {
  runChapterAction,
  createStoryController,
  storyMapDocument,
  safeMediaSrc,
  escapeHtml,
  ACTION_EVENT,
  CHAPTER_EVENT,
  STORY_GESTURE_DEFAULTS,
  type StoryMap,
} from "../../src/scrollytelling";
import { ChapterActionSchema, ScrollytellingBlockSchema } from "../../src/schemas";

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

const container = () => document.createElement("div");
const ctx = () => ({ container: container(), chapterId: "c1", phase: "enter" as const });

describe("runChapterAction covers every action the schema accepts", () => {
  const actions = (ChapterActionSchema.shape.action as unknown as { options: string[] }).options;

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
    expect(String(warn.mock.calls[0]![0])).toContain('no layer "nope"');
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

  it("fitBounds turns [w, s, e, n] into a LngLatBounds pair, top-down by default", () => {
    const { map, calls } = fakeMap();
    runChapterAction(map, { action: "fitBounds", bounds: [-74.3, 40.5, -73.7, 40.9], options: { padding: 50 } }, ctx());
    expect(calls).toEqual([
      ["fitBounds", [[-74.3, 40.5], [-73.7, 40.9]], { pitch: 0, bearing: 0, padding: 50 }],
    ]);
  });

  it("custom dispatches ml-scrollytelling:action with the action and phase", () => {
    const { map } = fakeMap();
    const c = ctx();
    const seen: CustomEvent[] = [];
    c.container.addEventListener(ACTION_EVENT, (e) => seen.push(e as CustomEvent));
    runChapterAction(map, { action: "custom", options: { name: "pulse" } }, c);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.detail).toMatchObject({ chapterId: "c1", phase: "enter", action: { options: { name: "pulse" } } });
    expect(seen[0]!.detail.map).toBe(map);
  });
});

describe("fitBounds never asks for more padding than the map has (review of ml-aot.39)", () => {
  // MapLibre ADDS the map's padding to fitBounds' padding. A centred desktop
  // card pads the bottom by up to 75%; with the action's own padding: 100 the
  // total exceeded the canvas: "Map cannot fit within canvas", no move.
  it("shrinks the card padding so card + action padding leave room for the bounds", () => {
    const { map, calls } = fakeMap();
    const c = { ...ctx(), padding: { top: 0, right: 0, bottom: 540, left: 0 }, mapSize: { width: 1280, height: 720 } };
    runChapterAction(map, { action: "fitBounds", bounds: [-74.3, 40.5, -73.7, 40.9], options: { padding: 100 } }, c);
    const jump = calls.find((call) => call[0] === "jumpTo")![1] as { padding: { top: number; bottom: number } };
    // 720 tall: 100 + 100 for the action, and at least a fifth of the map
    // left for the bounds themselves.
    expect(jump.padding.top + jump.padding.bottom + 200).toBeLessThanOrEqual(720 - 144);
    expect(jump.padding.bottom).toBeGreaterThan(0);
  });

  it("leaves the card padding alone when everything fits", () => {
    const { map, calls } = fakeMap();
    const c = { ...ctx(), padding: { top: 0, right: 0, bottom: 200, left: 0 }, mapSize: { width: 1280, height: 720 } };
    runChapterAction(map, { action: "fitBounds", bounds: [-74.3, 40.5, -73.7, 40.9], options: { padding: 50 } }, c);
    expect(calls.find((call) => call[0] === "jumpTo")![1]).toEqual({ padding: { top: 0, right: 0, bottom: 200, left: 0 } });
  });
});

describe("fitBounds frames at the chapter's own pitch/bearing (ml-aot.9)", () => {
  // The bug: fitBounds keeps the CURRENT pitch/bearing and interrupts the
  // chapter's flyTo, so a chapter after a pitched one stayed pitched.
  it("passes the chapter's pitch and bearing (0 by default)", () => {
    const { map, calls } = fakeMap();
    const chapter = { id: "pacific", pitch: 0, bearing: 0 } as never;
    runChapterAction(map, { action: "fitBounds", bounds: [100, -50, 290, 62] }, { ...ctx(), chapter });
    expect(calls[0]![2]).toMatchObject({ pitch: 0, bearing: 0 });
  });

  it("the action's own options win", () => {
    const { map, calls } = fakeMap();
    const chapter = { id: "c", pitch: 30, bearing: 10 } as never;
    runChapterAction(
      map,
      { action: "fitBounds", bounds: [0, 0, 1, 1], options: { pitch: 50 } },
      { ...ctx(), chapter }
    );
    expect(calls[0]![2]).toMatchObject({ pitch: 50, bearing: 10 });
  });
});

describe("reduced motion is explicit (ml-cxk)", () => {
  const instant = () => ({ ...ctx(), reducedMotion: true });

  it("flyTo / easeTo actions jump; fitBounds does not animate", () => {
    const { map, calls } = fakeMap();
    runChapterAction(map, { action: "flyTo", options: { center: [1, 2], zoom: 5 } }, instant());
    runChapterAction(map, { action: "easeTo", options: { zoom: 3 } }, instant());
    runChapterAction(map, { action: "fitBounds", bounds: [0, 0, 1, 1] }, instant());
    expect(calls.map((c) => c[0])).toEqual(["jumpTo", "jumpTo", "fitBounds"]);
    expect(calls[2]![2]).toMatchObject({ animate: false, duration: 0 });
  });

  it("an action marked essential still animates", () => {
    const { map, calls } = fakeMap();
    runChapterAction(map, { action: "flyTo", options: { zoom: 5, essential: true } }, instant());
    expect(calls[0]![0]).toBe("flyTo");
  });

  it("chapter camera moves jump, and ambient rotation never starts", () => {
    const { map, calls } = fakeMap();
    const story = ScrollytellingBlockSchema.parse({
      type: "scrollytelling",
      id: "s",
      config: { center: [0, 0], zoom: 1, mapStyle: "https://x/style.json" },
      chapters: [{ id: "a", title: "A", center: [10, 20], zoom: 4, animation: "flyTo", rotateAnimation: true }],
    });
    createStoryController(container(), story, map, { reducedMotion: () => true }).activate("a");
    expect(calls.map((c) => c[0])).toEqual(["jumpTo"]);
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
        pitch: 40,
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
  const motion = { reducedMotion: () => false };

  it("moves the camera, toggles layers, runs exit then enter actions, and announces the chapter", () => {
    const { map, calls } = fakeMap();
    const el = container();
    const events: CustomEvent[] = [];
    el.addEventListener(CHAPTER_EVENT, (e) => events.push(e as CustomEvent));
    const controller = createStoryController(el, story, map, motion);

    controller.activate("a");
    expect(calls[0]![0]).toBe("flyTo");
    expect(calls[0]![1]).toMatchObject({ center: [10, 20], zoom: 4, pitch: 40 });
    expect(calls).toContainEqual(["setLayoutProperty", "quakes", "visibility", "visible"]);
    expect(el.dataset.activeChapter).toBe("a");

    calls.length = 0;
    controller.activate("b");
    expect(calls.map((c) => c[0])).toEqual(["setPaintProperty", "jumpTo", "setLayoutProperty", "fitBounds"]);
    // ml-aot.9: chapter b frames top-down although chapter a was pitched.
    expect(calls[3]![2]).toMatchObject({ pitch: 0, bearing: 0 });
    expect(events.map((e) => e.detail.chapterId)).toEqual(["a", "b"]);
    expect(events[1]!.detail).toMatchObject({ previousChapterId: "a", index: 1, callback: "onB" });

    // Re-activating the active chapter is a no-op.
    calls.length = 0;
    controller.activate("b");
    expect(calls).toEqual([]);
  });

  it("rotateAnimation starts after the chapter's transition (moveend)", () => {
    const { map, calls } = fakeMap();
    const spinning = { ...story, chapters: [{ ...story.chapters[0], rotateAnimation: true }] };
    createStoryController(container(), spinning, map, motion).activate("a");
    expect(calls.some((c) => c[0] === "once" && c[1] === "moveend")).toBe(true);
  });

  it("passes the padding the element computes for the card (ml-aot.8)", () => {
    const { map, calls } = fakeMap();
    const padding = { top: 0, right: 0, bottom: 300, left: 0 };
    createStoryController(container(), story, map, { ...motion, padding: () => padding }).activate("a");
    expect(calls[0]![1]).toMatchObject({ padding });
  });

  it("before the map loads, marks the chapter; once it loads, lands there at once", () => {
    const { map, calls } = fakeMap();
    const el = container();
    el.innerHTML = '<section class="scrolly-chapter" data-chapter-id="a"></section><section class="scrolly-chapter is-active" data-chapter-id="b"></section>';
    const events: CustomEvent[] = [];
    el.addEventListener(CHAPTER_EVENT, (e) => events.push(e as CustomEvent));
    const controller = createStoryController(el, story, null, motion);

    controller.activate("a");
    expect(el.dataset.activeChapter).toBe("a");
    expect(el.querySelector('[data-chapter-id="a"]')!.classList.contains("is-active")).toBe(true);
    expect(el.querySelector('[data-chapter-id="b"]')!.classList.contains("is-active")).toBe(false);
    expect(events).toHaveLength(0);

    controller.setMap(map);
    expect(calls[0]![0]).toBe("jumpTo"); // no fly from the initial camera
    expect(calls[0]![1]).toMatchObject({ center: [10, 20], zoom: 4 });
    expect(events.map((e) => e.detail.chapterId)).toEqual(["a"]);
    expect(events[0]!.detail.map).toBe(map);
  });

  it("a map that failed still lets chapters activate and announce (map: null)", () => {
    const el = container();
    const events: CustomEvent[] = [];
    el.addEventListener(CHAPTER_EVENT, (e) => events.push(e as CustomEvent));
    const controller = createStoryController(el, story, null, motion);
    controller.setMap(null);
    controller.activate("b");
    expect(events.map((e) => [e.detail.chapterId, e.detail.map])).toEqual([["b", null]]);
  });

  it("marks the rail's current dot for assistive tech", () => {
    const { map } = fakeMap();
    const el = container();
    el.innerHTML = '<button class="chapter-marker" data-chapter-id="a"></button><button class="chapter-marker" data-chapter-id="b"></button>';
    const controller = createStoryController(el, story, map, motion);
    controller.activate("b");
    expect(el.querySelector('[data-chapter-id="b"]')!.getAttribute("aria-current")).toBe("step");
    expect(el.querySelector('[data-chapter-id="a"]')!.hasAttribute("aria-current")).toBe(false);
  });
});

describe("storyMapDocument", () => {
  it("is the map half of a story, with the map's own gestures off", () => {
    expect(
      storyMapDocument({ id: "s", config: { center: [0, 0], zoom: 1 } as never, layers: undefined as never } as never)
    ).toEqual({
      type: "map",
      id: "s-map",
      config: { ...STORY_GESTURE_DEFAULTS, center: [0, 0], zoom: 1 },
      layers: [],
    });
  });

  it("root keys misplaced under the story's config: are not passed to the map (one message per mistake, ml-aot.63)", () => {
    const doc = storyMapDocument({
      id: "s",
      config: { center: [0, 0], zoom: 1, theme: "dark", markers: [], legend: {} } as never,
    } as never);
    const config = doc.config as Record<string, unknown>;
    expect(config.theme).toBeUndefined();
    expect(config.markers).toBeUndefined();
    expect(config.legend).toBeUndefined();
    expect(config.center).toEqual([0, 0]);
  });

  it("a story that sets a gesture keeps it", () => {
    const doc = storyMapDocument({ id: "s", config: { scrollZoom: true } as never } as never);
    expect((doc.config as Record<string, unknown>).scrollZoom).toBe(true);
    expect((doc.config as Record<string, unknown>).dragPan).toBe(false);
  });

  it("carries the map-level keys a story shares with a map document (ml-t2x)", () => {
    const doc = storyMapDocument({
      id: "s",
      config: {} as never,
      sources: { pts: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
      markers: [{ at: [0, 0] }],
      legend: { items: [] },
      state: { k: { default: 1 } },
      parameters: { k: { type: "number" } },
      footer: "<p>not map</p>",
    } as never);
    expect(Object.keys(doc)).toEqual(
      expect.arrayContaining(["sources", "markers", "legend", "state", "parameters"])
    );
    expect(doc).not.toHaveProperty("footer");
  });
});

describe("helpers", () => {
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
