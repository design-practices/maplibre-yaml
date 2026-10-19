/**
 * The missing-image console warning only blames the document for images the
 * document references (ml-aot.37). OpenFreeMap Liberty's sprite lacks some
 * POI icons ("office", "running" …); MapLibre already logs those, and our
 * "layer references image … but no images: entry …" pointed a student at
 * their YAML for a basemap gap they cannot fix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MapRenderer } from "../../src/renderer/map-renderer";

vi.mock("maplibre-gl", () => {
  class MockMap {
    private events = new Map<string, Set<Function>>();
    public addLayer = vi.fn();
    public addSource = vi.fn();
    public getLayer = vi.fn();
    public getSource = vi.fn();
    public addControl = vi.fn();
    public removeControl = vi.fn();
    public hasImage = vi.fn(() => false);
    getCanvas() {
      return { style: { cursor: "" } };
    }
    on(event: string, callback: Function) {
      if (!this.events.has(event)) this.events.set(event, new Set());
      this.events.get(event)!.add(callback);
    }
    off(event: string, callback: Function) {
      this.events.get(event)?.delete(callback);
    }
    emit(event: string, data?: any) {
      this.events.get(event)?.forEach((cb) => cb(data));
    }
    remove() {}
  }
  const ctrl = vi.fn(() => ({}));
  const api = {
    Map: MockMap,
    NavigationControl: ctrl,
    GeolocateControl: ctrl,
    ScaleControl: ctrl,
    FullscreenControl: ctrl,
    AttributionControl: ctrl,
    Popup: vi.fn(),
  };
  return { default: api, ...api };
});

const CONFIG = { center: [0, 0] as [number, number], zoom: 14, mapStyle: "https://tiles.openfreemap.org/styles/liberty" };
const inline = { type: "geojson", data: { type: "FeatureCollection", features: [] } };

describe("missing-image warning (ml-aot.37)", () => {
  let container: HTMLElement;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    document.body.innerHTML = "";
  });

  const ours = () =>
    warnSpy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("references image"));

  async function missing(layers: any[], ids: string[]) {
    const r = new MapRenderer(container, CONFIG, layers, {}, {});
    const map = r.getMap() as any;
    for (const id of ids) map.emit("styleimagemissing", { id });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return r;
  }

  it("stays quiet for an image only the basemap uses", async () => {
    await missing([{ id: "pts", type: "circle", source: inline }], ["office", "running"]);
    expect(ours()).toEqual([]);
  });

  it("warns for an image a document layer names", async () => {
    await missing(
      [{ id: "pins", type: "symbol", source: inline, layout: { "icon-image": "my-pin" } }],
      ["office", "my-pin"]
    );
    expect(ours()).toEqual([
      '[maplibre-yaml] layer references image "my-pin" but no images: entry, sprite, or addImage call supplies it.',
    ]);
  });

  it("finds names inside expressions and pattern properties", async () => {
    await missing(
      [
        {
          id: "pins",
          type: "symbol",
          source: inline,
          layout: { "icon-image": ["match", ["get", "kind"], "cafe", "cup", "dot"] },
        },
        { id: "hatch", type: "fill", source: inline, paint: { "fill-pattern": "stripes" } },
      ],
      ["cup", "stripes", "office"]
    );
    expect(ours().map((m) => m.match(/"([^"]+)"/)![1])).toEqual(["cup", "stripes"]);
  });

  it("a legacy token string ('{icon}-15') is data-built: a miss gets the data note, never silence (A5)", async () => {
    await missing(
      [{ id: "pins", type: "symbol", source: inline, layout: { "icon-image": "{icon}-15" } }],
      ["cafe-15"]
    );
    const msgs = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(msgs.some((m) => m.includes('image "cafe-15"') && m.includes("feature data"))).toBe(true);
  });

  it("a name the document sets at runtime (noteImageReference) is the document's (A5)", async () => {
    const r = await missing([{ id: "pts", type: "circle", source: inline }], []);
    r.noteImageReference("icon-image", ["match", ["get", "kind"], "a", "chapter-icon", "other-icon"]);
    r.noteImageReference("circle-color", "not-an-image");
    const map = r.getMap() as any;
    for (const id of ["chapter-icon", "not-an-image"]) map.emit("styleimagemissing", { id });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ours().map((m) => m.match(/"([^"]+)"/)![1])).toEqual(["chapter-icon"]);
  });

  it("a story's chapter actions that set image properties are recorded (A5)", async () => {
    const { noteStoryImageRefs } = await import("../../src/utils/image-refs");
    const noted: Array<[string, unknown]> = [];
    noteStoryImageRefs(
      { noteImageReference: (p: string, v: unknown) => noted.push([p, v]) },
      {
        chapters: [
          {
            id: "a",
            onChapterEnter: [
              { action: "setLayoutProperty", layer: "pins", property: "icon-image", value: "star" },
              { action: "setPaintProperty", layer: "pins", property: "icon-color", value: "#f00" },
            ],
            onChapterExit: [{ action: "setPaintProperty", layer: "area", property: "fill-pattern", value: "dots" }],
          },
        ],
      } as any
    );
    expect(noted).toEqual([
      ["icon-image", "star"],
      ["icon-color", "#f00"],
      ["fill-pattern", "dots"],
    ]);
  });

  it("with a name built from feature data, a miss is reported without blaming the YAML", async () => {
    await missing(
      [{ id: "pins", type: "symbol", source: inline, layout: { "icon-image": ["get", "icon"] } }],
      ["office"]
    );
    const msgs = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(ours()).toEqual([]);
    expect(msgs.some((m) => m.includes('image "office"') && m.includes("basemap"))).toBe(true);
  });
});
