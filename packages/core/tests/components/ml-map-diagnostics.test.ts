/**
 * <ml-map> developer diagnostics (console-only, per decision D11):
 *  - parser warnings are logged to console.warn (never the error card),
 *  - a zero-height host element is flagged,
 *  - a missing MapLibre stylesheet is flagged.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("maplibre-gl", () => {
  const Map = vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    remove: vi.fn(),
    addSource: vi.fn(),
    addLayer: vi.fn(),
    getSource: vi.fn(),
    getLayer: vi.fn(),
    getCanvas: vi.fn(() => ({ style: { cursor: "" } })),
  }));
  return { default: { Map }, Map };
});

vi.mock("../../src/renderer/map-renderer", () => ({
  MapRenderer: vi.fn().mockImplementation(() => ({
    getMap: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
    destroy: vi.fn(),
    on: vi.fn(),
  })),
}));

import { MLMap } from "../../src/components/ml-map";

const VALID_CONFIG = {
  type: "map",
  id: "test-map",
  config: {
    mapStyle: "https://demotiles.maplibre.org/style.json",
    center: [0, 0],
    zoom: 1,
  },
};

function makeElement(): MLMap {
  const el = document.createElement("ml-map") as MLMap;
  el.setAttribute("config", JSON.stringify(VALID_CONFIG));
  return el;
}

/**
 * jsdom performs no layout, so `offsetParent` is always `null`. Simulate a
 * laid-out (visible) element so the visibility-gated zero-height diagnostic can
 * fire under test.
 */
function markLaidOut(el: MLMap): void {
  Object.defineProperty(el, "offsetParent", {
    configurable: true,
    get: () => document.body,
  });
}

describe("MLMap diagnostics", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    if (!customElements.get("ml-map")) {
      customElements.define("ml-map", MLMap);
    }
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function warnings(): string[] {
    return warnSpy.mock.calls.map((c) => String(c[0]));
  }

  it("warns about a zero-height host element", async () => {
    // jsdom reports getBoundingClientRect().height === 0 by default; mark the
    // element as laid out so the visibility-gated warning can fire.
    const el = makeElement();
    markLaidOut(el);
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 10));

    expect(
      warnings().some((m) => m.includes("zero height"))
    ).toBe(true);
  });

  it("does not warn about height when the host has a measurable height", async () => {
    const el = makeElement();
    markLaidOut(el);
    el.getBoundingClientRect = () =>
      ({ height: 400, width: 400 } as DOMRect);
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 10));

    expect(
      warnings().some((m) => m.includes("zero height"))
    ).toBe(false);
  });

  it("does not warn about zero height when the element is not laid out", async () => {
    // A hidden / not-yet-mounted map (offsetParent === null, jsdom default)
    // legitimately has zero height and must not be flagged as a mistake.
    const el = makeElement();
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 10));

    expect(
      warnings().some((m) => m.includes("zero height"))
    ).toBe(false);
  });

  it("runs the environment diagnostics at most once across re-renders", async () => {
    const el = makeElement();
    markLaidOut(el);
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 10));
    expect(
      warnings().filter((m) => m.includes("zero height")).length
    ).toBe(1);

    // A second render (config update / reload) must not re-spam diagnostics.
    el.config = VALID_CONFIG as unknown as typeof el.config;
    await new Promise((r) => setTimeout(r, 10));
    expect(
      warnings().filter((m) => m.includes("zero height")).length
    ).toBe(1);
  });

  it("warns when MapLibre CSS is not loaded", async () => {
    const el = makeElement();
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 10));

    expect(
      warnings().some((m) => m.includes("MapLibre GL CSS"))
    ).toBe(true);
  });

  it("does not warn about CSS when the maplibre canary is styled", async () => {
    const style = document.createElement("style");
    style.textContent =
      ".maplibregl-canary { background-color: rgb(250, 128, 114); }";
    document.head.appendChild(style);

    const el = makeElement();
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 10));

    expect(
      warnings().some((m) => m.includes("MapLibre GL CSS"))
    ).toBe(false);
  });

  it("logs parser warnings to console.warn, not the error card", async () => {
    const el = document.createElement("ml-map") as MLMap;
    const script = document.createElement("script");
    script.type = "text/yaml";
    script.textContent = `
type: map
id: test-map
config:
  center: [0, 0]
  zoom: 1
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers:
  - id: p
    type: circle
    source: { type: geojson, url: "https://example.com/d.geojson" }
    paint:
      circle-radis: 8
`;
    el.appendChild(script);
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 10));

    // The typo is a warning, surfaced on the console...
    expect(
      warnings().some((m) => m.includes("circle-radis"))
    ).toBe(true);
    // ...and the map still renders (no error card).
    expect(el.querySelector(".ml-map-error")).toBeNull();
    expect(el.getRenderer()).toBeTruthy();
  });
});
