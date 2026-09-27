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

  it("a failed icon load swaps in the default pin with one warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const manager = new MarkersManager(MAP);
    manager.add([
      { at: [0, 0], icon: "https://x.example/broken.png" },
      { at: [1, 1], icon: "https://x.example/broken2.png" },
    ] as any);

    const img = markerInstances[0].options.element as HTMLImageElement;
    document.body.appendChild(img); // replaceWith needs a parent
    img.dispatchEvent(new Event("error"));
    (markerInstances[1].options.element as HTMLImageElement).dispatchEvent(new Event("error"));

    // A fallback Marker was constructed for its default-pin element…
    expect(markerInstances.length).toBeGreaterThan(2);
    // …and the warning fired once for the document, not per marker.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("default pin");
    warn.mockRestore();
  });

  it("destroy removes every marker", () => {
    const manager = new MarkersManager(MAP);
    manager.add([{ at: [0, 0] }, { at: [1, 1] }] as any);
    manager.destroy();
    expect(markerInstances[0].remove).toHaveBeenCalled();
    expect(markerInstances[1].remove).toHaveBeenCalled();
  });
});
