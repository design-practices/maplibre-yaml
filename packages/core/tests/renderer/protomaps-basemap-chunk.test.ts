/**
 * The Protomaps style generator is an on-demand chunk (ml-cnv.7 on the
 * ml-7qa.5 seam). When it can't be downloaded, the map still loads: a plain
 * background under the document's own layers, and the map's notice.
 */
import { describe, it, expect, vi } from "vitest";
import { FormatError } from "../../src/formats/errors";

vi.mock("../../src/formats/decoders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/formats/decoders")>();
  return {
    ...actual,
    getDecoder: (name: string) =>
      name === "protomaps-basemap"
        ? Promise.reject(
            new FormatError({ code: "chunk", format: name as never, url: "chunks/protomaps-basemap.js", detail: "offline" })
          )
        : actual.getDecoder(name as never),
    prefetchDecoder: () => undefined,
  };
});

vi.mock("maplibre-gl", () => {
  class MockMap {
    private events = new Map<string, Set<Function>>();
    public ctorOptions: any;
    public setStyle = vi.fn();
    public addControl = vi.fn();
    public getSource = vi.fn();
    public container: HTMLElement;
    public canvas?: HTMLCanvasElement;
    constructor(options?: any) {
      this.ctorOptions = options;
      this.container = options.container;
    }
    getContainer() {
      return this.container;
    }
    getCanvas() {
      return (this.canvas ??= document.createElement("canvas"));
    }
    on(event: string, cb: Function) {
      if (!this.events.has(event)) this.events.set(event, new Set());
      this.events.get(event)!.add(cb);
    }
    off(event: string, cb: Function) {
      this.events.get(event)?.delete(cb);
    }
    remove() {}
  }
  const AttributionControl = vi.fn(() => ({ type: "attribution" }));
  return { default: { Map: MockMap, AttributionControl }, Map: MockMap, AttributionControl };
});

import { MapRenderer } from "../../src/renderer/map-renderer";

describe("the Protomaps generator chunk can't be downloaded", () => {
  it("sets a plain background (glyphs kept) and reports a non-fatal basemap notice", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onError = vi.fn();
    const renderer = new MapRenderer(
      container,
      { center: [0, 0], zoom: 2, mapStyle: { pmtiles: "data/x.pmtiles" } } as never,
      [],
      { onError }
    );
    const map = renderer.getMap() as any;
    for (let i = 0; i < 100 && map.setStyle.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    const style = map.setStyle.mock.calls[0][0];
    expect(style.layers.map((l: { id: string }) => l.id)).toEqual(["background"]);
    expect(style.glyphs).toMatch(/\{fontstack\}\/\{range\}\.pbf$/);
    expect(onError).toHaveBeenCalledTimes(1);
    const [error, fatal, context] = onError.mock.calls[0];
    expect(fatal).toBe(false);
    expect(context).toEqual({ kind: "basemap" });
    expect(error.message).toContain("Protomaps basemap reader");
    expect(error.message).toContain("couldn't be downloaded");
  });
});
