/**
 * @file Live markers — DOM lifecycle, popup trust gate, icon fallback (U5)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const markerInstances: any[] = [];
const popupInstances: any[] = [];

vi.mock("maplibre-gl", () => {
  const Marker = vi.fn((options?: any) => {
    const element = options?.element ?? document.createElement("div");
    const instance = {
      options,
      element,
      setLngLat: vi.fn().mockReturnThis(),
      setPopup: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      getElement: vi.fn(() => element),
      remove: vi.fn(),
    };
    markerInstances.push(instance);
    return instance;
  });
  const Popup = vi.fn(() => {
    const instance = {
      html: "",
      setHTML: vi.fn(function (this: any, html: string) {
        this.html = html;
        return this;
      }),
      setLngLat: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn(),
      on: vi.fn(),
    };
    popupInstances.push(instance);
    return instance;
  });
  return { default: { Marker, Popup }, Marker, Popup };
});

import { MarkersManager } from "../../src/renderer/markers-manager";

const MAP = {} as any;

describe("MarkersManager", () => {
  beforeEach(() => {
    markerInstances.length = 0;
    popupInstances.length = 0;
    vi.clearAllMocks();
  });

  it("adds a marker per config with color/scale mapped to MapLibre's options", () => {
    const manager = new MarkersManager(MAP);
    manager.add([
      { at: [0, 0] },
      { at: [1, 1], color: "#e63946", size: 2 },
    ] as any);

    expect(markerInstances).toHaveLength(2);
    expect(markerInstances[0].options).toEqual({});
    expect(markerInstances[1].options).toEqual({ color: "#e63946", scale: 2 });
    expect(markerInstances[1].setLngLat).toHaveBeenCalledWith([1, 1]);
    expect(markerInstances[1].addTo).toHaveBeenCalledWith(MAP);
  });

  it("marker popups run through the PopupBuilder gate — markup in values is escaped", () => {
    const manager = new MarkersManager(MAP, { trust: "untrusted" });
    manager.add([
      { at: [0, 0], popup: [{ p: [{ str: "<b>bold</b>" }] }] },
    ] as any);

    expect(markerInstances[0].setPopup).toHaveBeenCalled();
    const html = popupInstances[0].html as string;
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("icon markers use an <img> element sized like the pin", () => {
    const manager = new MarkersManager(MAP);
    manager.add([{ at: [0, 0], icon: "https://x.example/pin.png", size: 2 }] as any);

    const element = markerInstances[0].options.element as HTMLImageElement;
    expect(element.tagName).toBe("IMG");
    expect(element.src).toContain("pin.png");
    expect(element.style.width).toBe("54px");
  });

  it("a failed icon load replaces the whole marker with a default pin, once-warned", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errors: Array<[number, string]> = [];
    const manager = new MarkersManager(MAP, undefined, {
      onMarkerIconError: (index, icon) => errors.push([index, icon]),
    });
    manager.add([
      { at: [0, 0], icon: "https://x.example/broken.png", color: "#e63946", size: 2 },
      { at: [1, 1], icon: "https://x.example/broken2.png" },
    ] as any);

    expect(markerInstances).toHaveLength(2);
    (markerInstances[0].options.element as HTMLImageElement).dispatchEvent(new Event("error"));
    (markerInstances[1].options.element as HTMLImageElement).dispatchEvent(new Event("error"));

    // The broken markers were REMOVED (never DOM-swapped — MapLibre keeps
    // transforming the element it was constructed with) and replaced by
    // fresh default-pin markers carrying the config's color/scale.
    expect(markerInstances).toHaveLength(4);
    expect(markerInstances[0].remove).toHaveBeenCalled();
    expect(markerInstances[1].remove).toHaveBeenCalled();
    expect(markerInstances[2].options).toEqual({ color: "#e63946", scale: 2 });
    expect(markerInstances[2].setLngLat).toHaveBeenCalledWith([0, 0]);
    expect(markerInstances[2].addTo).toHaveBeenCalledWith(MAP);
    // The warning fired once for the document; the callback fired per marker.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("default pin");
    expect(errors).toEqual([
      [0, "https://x.example/broken.png"],
      [1, "https://x.example/broken2.png"],
    ]);
    warn.mockRestore();
  });

  it("destroy after an icon fallback removes the replacement marker too", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const manager = new MarkersManager(MAP);
    manager.add([{ at: [0, 0], icon: "https://x.example/broken.png" }] as any);
    (markerInstances[0].options.element as HTMLImageElement).dispatchEvent(new Event("error"));
    manager.destroy();
    expect(markerInstances[1].remove).toHaveBeenCalled();
    vi.mocked(console.warn).mockRestore();
  });

  it("an unsafe icon URL scheme is refused — default pin, warning, error callback", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errors: Array<[number, string]> = [];
    const manager = new MarkersManager(MAP, undefined, {
      onMarkerIconError: (index, icon) => errors.push([index, icon]),
    });
    // eslint-disable-next-line no-script-url
    manager.add([{ at: [0, 0], icon: "javascript:alert(1)", color: "#333333" }] as any);

    // No <img> was ever created for the unsafe URL.
    expect(markerInstances).toHaveLength(1);
    expect(markerInstances[0].options).toEqual({ color: "#333333" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("unsafe URL scheme");
    expect(errors).toEqual([[0, "javascript:alert(1)"]]);
    warn.mockRestore();
  });

  it("surfaces markers:added and marker:click through the callbacks", () => {
    const added: number[] = [];
    const clicks: Array<[number, [number, number]]> = [];
    const manager = new MarkersManager(MAP, undefined, {
      onMarkersAdded: (count) => added.push(count),
      onMarkerClick: (index, at) => clicks.push([index, at]),
    });
    manager.add([{ at: [0, 0] }, { at: [3, 4] }] as any);

    expect(added).toEqual([2]);
    markerInstances[1].element.dispatchEvent(new Event("click"));
    expect(clicks).toEqual([[1, [3, 4]]]);
  });

  it("destroy removes every marker", () => {
    const manager = new MarkersManager(MAP);
    manager.add([{ at: [0, 0] }, { at: [1, 1] }] as any);
    manager.destroy();
    expect(markerInstances[0].remove).toHaveBeenCalled();
    expect(markerInstances[1].remove).toHaveBeenCalled();
  });
});
