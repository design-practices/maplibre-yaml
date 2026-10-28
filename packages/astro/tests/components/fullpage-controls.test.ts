// @vitest-environment jsdom
/**
 * @file FullPageMap's browser wiring under live documents (U10)
 * @module @maplibre-yaml/astro/tests/components/fullpage-controls
 *
 * @description
 * Drives `installFullPageControls` in a DOM with a fake `<ml-map>` and a
 * fake MapLibre map: the reset target follows an in-place camera change
 * (`ml-map:update-applied` with `summary.cameraMoved`), waiting for the ease
 * to settle; the zoom buttons track the document's own navigation control
 * across in-place updates and fallback rebuilds, and stay a single set.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installFullPageControls } from "../../src/client/fullpage-controls";

const HERE = dirname(fileURLToPath(import.meta.url));

type Camera = { center: [number, number]; zoom: number; bearing: number; pitch: number };

/** The slice of maplibre's Map the wiring touches. */
function fakeMap(camera: Camera) {
  const once: Record<string, Array<() => void>> = {};
  return {
    camera,
    moving: false,
    getCenter: () => ({ toArray: () => [...camera.center] }),
    getZoom: () => camera.zoom,
    getBearing: () => camera.bearing,
    getPitch: () => camera.pitch,
    isMoving() {
      return this.moving;
    },
    once(type: string, fn: () => void) {
      (once[type] ??= []).push(fn);
    },
    /** End an ease: the camera is now `at`, then `moveend` fires. */
    settle(at: Camera) {
      Object.assign(camera, at);
      this.moving = false;
      once.moveend?.shift()?.();
    },
    pending: (type: string) => once[type]?.length ?? 0,
    flyTo: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
  };
}

class FakeMLMap extends HTMLElement {
  map: ReturnType<typeof fakeMap> | null = null;
  getMap() {
    return this.map;
  }
  mapReady() {
    return Promise.resolve();
  }
  uiString(key: string) {
    return `t:${key}`;
  }
}

const CONTROLS = `
  <div slot="top-right" class="ml-map-controls">
    <button class="ml-control-btn ml-zoom-in" data-action="zoom-in" aria-label="Zoom in"></button>
    <button class="ml-control-btn ml-zoom-out" data-action="zoom-out" aria-label="Zoom out"></button>
    <button class="ml-control-btn ml-reset" data-action="reset" aria-label="Reset view"></button>
  </div>`;

/** A FullPageMap's markup as the component renders it, with a loaded fake map. */
function mount(camera: Camera) {
  document.body.innerHTML = `<div class="ml-fullpage-map"><ml-map>${CONTROLS}</ml-map></div>`;
  const mapEl = document.querySelector("ml-map") as FakeMLMap;
  mapEl.map = fakeMap(camera);
  return { mapEl, map: mapEl.map };
}

const fire = (el: Element, type: string, detail?: unknown) =>
  el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));

const summary = (over: Partial<Record<"cameraMoved" | "rebuild", boolean>> = {}) => ({
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

const reset = (mapEl: Element) =>
  mapEl.querySelector('[data-action="reset"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

const HOME: Camera = { center: [0, 0], zoom: 2, bearing: 0, pitch: 0 };
const NEXT: Camera = { center: [10, 20], zoom: 5, bearing: 0, pitch: 0 };

beforeAll(() => {
  customElements.define("ml-map", FakeMLMap);
  installFullPageControls();
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("reset target follows in-place camera changes", () => {
  it("re-captures home once the ease settles when the summary says the camera moved", () => {
    const { mapEl, map } = mount({ ...HOME });
    fire(mapEl, "ml-map:load");
    reset(mapEl);
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [0, 0], zoom: 2 }));

    // Core eases to the new camera and fires update-applied while the ease runs.
    map.moving = true;
    fire(mapEl, "ml-map:update-applied", { summary: summary({ cameraMoved: true }) });
    expect(map.pending("moveend")).toBe(1);
    // Mid-ease, the old view is still home: no half-way camera captured.
    reset(mapEl);
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [0, 0], zoom: 2 }));

    map.settle({ ...NEXT });
    reset(mapEl);
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [10, 20], zoom: 5 }));
  });

  it("re-captures right away when the map is not moving (duration 0, reduced motion)", () => {
    const { mapEl, map } = mount({ ...HOME });
    fire(mapEl, "ml-map:load");
    Object.assign(map.camera, NEXT);
    fire(mapEl, "ml-map:update-applied", { summary: summary({ cameraMoved: true }) });
    expect(map.pending("moveend")).toBe(0);
    reset(mapEl);
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [10, 20], zoom: 5 }));
  });

  it("keeps home when the camera did not move (a layer edit, or camera=\"host\")", () => {
    const { mapEl, map } = mount({ ...HOME });
    fire(mapEl, "ml-map:load");
    // The visitor panned away; the document's layers changed; home stays the opening view.
    Object.assign(map.camera, NEXT);
    fire(mapEl, "ml-map:update-applied", { summary: summary({ cameraMoved: false }) });
    reset(mapEl);
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [0, 0], zoom: 2 }));
  });

  it("a fallback rebuild re-captures on ml-map:load, as before", () => {
    const { mapEl, map } = mount({ ...HOME });
    fire(mapEl, "ml-map:load");
    Object.assign(map.camera, NEXT);
    fire(mapEl, "ml-map:load");
    fire(mapEl, "ml-map:update-applied", { summary: summary({ rebuild: true }) });
    reset(mapEl);
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [10, 20], zoom: 5 }));
  });
});

describe("zoom buttons follow the document's controls", () => {
  const zoomSets = (mapEl: Element) => ({
    controls: mapEl.querySelectorAll(".ml-map-controls").length,
    zoomIn: mapEl.querySelectorAll('[data-action="zoom-in"]').length,
  });

  it("hides the component's zoom buttons when an in-place update adds the document's navigation control", () => {
    const { mapEl } = mount({ ...HOME });
    fire(mapEl, "ml-map:load");
    const buttons = mapEl.querySelector(".ml-map-controls")!;
    expect(buttons.hasAttribute("data-document-zoom")).toBe(false);

    // Core adds the control in place (controls is not a rebuild key): no ml-map:load.
    mapEl.insertAdjacentHTML("beforeend", '<div class="maplibregl-ctrl"><button class="maplibregl-ctrl-zoom-in"></button></div>');
    fire(mapEl, "ml-map:update-applied", { summary: summary() });
    expect(buttons.hasAttribute("data-document-zoom")).toBe(true);
    expect(zoomSets(mapEl)).toEqual({ controls: 1, zoomIn: 1 });

    // ...and drops it again.
    mapEl.querySelector(".maplibregl-ctrl")!.remove();
    fire(mapEl, "ml-map:update-applied", { summary: summary() });
    expect(buttons.hasAttribute("data-document-zoom")).toBe(false);
    expect(zoomSets(mapEl)).toEqual({ controls: 1, zoomIn: 1 });
  });

  it("stays one set of buttons across an update that rebuilt the map", () => {
    const { mapEl } = mount({ ...HOME });
    fire(mapEl, "ml-map:load");
    // A basemap change: ml-map:load fires again, then update-applied with rebuild.
    mapEl.insertAdjacentHTML("beforeend", '<button class="maplibregl-ctrl-zoom-in"></button>');
    fire(mapEl, "ml-map:load");
    fire(mapEl, "ml-map:update-applied", { summary: summary({ rebuild: true }) });
    expect(zoomSets(mapEl)).toEqual({ controls: 1, zoomIn: 1 });
    expect(mapEl.querySelector(".ml-map-controls")!.hasAttribute("data-document-zoom")).toBe(true);
  });

  it("relabels the buttons in the applied document's language", () => {
    const { mapEl } = mount({ ...HOME });
    fire(mapEl, "ml-map:update-applied", { summary: summary() });
    const button = mapEl.querySelector<HTMLElement>('[data-action="reset"]')!;
    expect(button.getAttribute("aria-label")).toBe("t:maplibre-yaml.FullPageMap.ResetView");
    expect(button.title).toBe("t:maplibre-yaml.FullPageMap.ResetView");
    expect(mapEl.querySelector('[data-action="zoom-in"]')!.getAttribute("aria-label")).toBe("t:NavigationControl.ZoomIn");
  });

  it("ignores update-applied from an <ml-map> that is not a FullPageMap's", () => {
    document.body.innerHTML = `<ml-map>${CONTROLS}</ml-map>`;
    const stray = document.querySelector("ml-map") as FakeMLMap;
    stray.map = fakeMap({ ...HOME });
    stray.insertAdjacentHTML("beforeend", '<button class="maplibregl-ctrl-zoom-in"></button>');
    fire(stray, "ml-map:update-applied", { summary: summary({ cameraMoved: true }) });
    expect(stray.querySelector(".ml-map-controls")!.hasAttribute("data-document-zoom")).toBe(false);
  });
});

describe("wiring", () => {
  it("FullPageMap.astro installs the module from its script and no longer inlines the listeners", () => {
    const src = readFileSync(join(HERE, "../../src/components/FullPageMap.astro"), "utf8");
    expect(src).toContain('import { installFullPageControls } from "../client/fullpage-controls";');
    expect(src).toContain("installFullPageControls();");
    expect(src).not.toContain('addEventListener("ml-map:load"');
    const module = readFileSync(join(HERE, "../../src/client/fullpage-controls.ts"), "utf8");
    for (const type of ["ml-map:load", "ml-map:update-applied", "ml-map:camera-fit"]) {
      expect(module).toContain(`addEventListener("${type}"`);
    }
  });
});
