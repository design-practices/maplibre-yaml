/**
 * `base` for the URLs inside a map document (ml-aot.30): a site deployed
 * under a subpath (a GitHub Pages project site, `/my-repo/`) keeps its files
 * at `/my-repo/data/x.geojson`, and a document written as `/data/x.geojson`
 * or `data/x.geojson` must load them there. Every URL-bearing field of the
 * schema is listed here, so a field added without resolution fails the walk
 * test rather than 404ing on someone's deployed site.
 */
import { describe, it, expect, vi } from "vitest";

// The export check below imports the package barrel, which loads
// maplibre-gl. On the CI matrix's 4.x/5.x legs that is the UMD bundle,
// which calls URL.createObjectURL at import time (absent in jsdom). The
// resolver itself never touches MapLibre, so a stub is enough.
vi.mock("maplibre-gl", () => ({ default: {} }));
import { YAMLParser } from "../../src/parser/yaml-parser";
import { toModel } from "../../src/model/to-model";
import {
  denormalizeConfig,
  denormalizeLayers,
  denormalizeOptions,
  denormalizeSources,
} from "../../src/model/normalize";
import type { MapModel } from "../../src/model/types";
import {
  applyDocumentBase,
  applyDocumentBaseToLayer,
  normalizeDocumentBase,
  resolveDocumentUrl,
} from "../../src/utils/document-base";
import * as core from "../../src/index";

describe("normalizeDocumentBase", () => {
  it("accepts the spellings people write, always ending in /", () => {
    expect(normalizeDocumentBase("/my-repo")).toBe("/my-repo/");
    expect(normalizeDocumentBase("/my-repo/")).toBe("/my-repo/");
    expect(normalizeDocumentBase("my-repo")).toBe("/my-repo/");
    expect(normalizeDocumentBase("my-repo/")).toBe("/my-repo/");
    expect(normalizeDocumentBase("  /my-repo  ")).toBe("/my-repo/");
    expect(normalizeDocumentBase("/a/b")).toBe("/a/b/");
    expect(normalizeDocumentBase("/")).toBe("/");
    expect(normalizeDocumentBase("https://cdn.example.com/site")).toBe("https://cdn.example.com/site/");
    expect(normalizeDocumentBase("https://cdn.example.com")).toBe("https://cdn.example.com/");
  });

  it("is null when there is no base", () => {
    expect(normalizeDocumentBase(undefined)).toBeNull();
    expect(normalizeDocumentBase(null)).toBeNull();
    expect(normalizeDocumentBase("")).toBeNull();
    expect(normalizeDocumentBase("   ")).toBeNull();
  });
});

describe("resolveDocumentUrl", () => {
  for (const base of ["/my-repo/", "/my-repo", "my-repo"]) {
    describe(`base ${JSON.stringify(base)}`, () => {
      it("puts root-relative paths under the base", () => {
        expect(resolveDocumentUrl("/data/x.geojson", base)).toBe("/my-repo/data/x.geojson");
        expect(resolveDocumentUrl("/x.png?v=2#a", base)).toBe("/my-repo/x.png?v=2#a");
      });

      it("resolves relative paths against the base, not the page", () => {
        expect(resolveDocumentUrl("data/x.geojson", base)).toBe("/my-repo/data/x.geojson");
        expect(resolveDocumentUrl("./data/x.geojson", base)).toBe("/my-repo/data/x.geojson");
        expect(resolveDocumentUrl("x.geojson", base)).toBe("/my-repo/x.geojson");
        expect(resolveDocumentUrl("a/../b/./x.geojson", base)).toBe("/my-repo/b/x.geojson");
        expect(resolveDocumentUrl("../x.geojson", base)).toBe("/x.geojson");
      });

      it("never doubles a base already written into the path", () => {
        expect(resolveDocumentUrl("/my-repo/data/x.geojson", base)).toBe("/my-repo/data/x.geojson");
        expect(resolveDocumentUrl("/my-repo", base)).toBe("/my-repo");
        expect(resolveDocumentUrl("/my-repo?x=1", base)).toBe("/my-repo?x=1");
        // A different folder that merely starts with the same letters is not the base.
        expect(resolveDocumentUrl("/my-repository/x.geojson", base)).toBe(
          "/my-repo/my-repository/x.geojson"
        );
      });

      it("leaves absolute, protocol-relative, blob:, data: and fragment URLs alone", () => {
        for (const url of [
          "https://example.com/data/x.geojson",
          "http://example.com/x",
          "//cdn.example.com/x.png",
          "blob:https://example.com/0c6f-4a1b",
          "data:application/json,{}",
          "pmtiles://https://example.com/a.pmtiles",
          "mailto:someone@example.com",
          "#top",
          "?q=1",
        ]) {
          expect(resolveDocumentUrl(url, base)).toBe(url);
        }
      });

      it("keeps tile and glyph placeholders verbatim", () => {
        expect(resolveDocumentUrl("/tiles/{z}/{x}/{y}.pbf", base)).toBe("/my-repo/tiles/{z}/{x}/{y}.pbf");
        expect(resolveDocumentUrl("fonts/{fontstack}/{range}.pbf", base)).toBe(
          "/my-repo/fonts/{fontstack}/{range}.pbf"
        );
      });
    });
  }

  it("base / makes relative paths site-root-relative and leaves /paths alone", () => {
    expect(resolveDocumentUrl("data/x.geojson", "/")).toBe("/data/x.geojson");
    expect(resolveDocumentUrl("/data/x.geojson", "/")).toBe("/data/x.geojson");
  });

  it("an absolute base yields absolute URLs", () => {
    const base = "https://cdn.example.com/site/";
    expect(resolveDocumentUrl("/data/x.geojson", base)).toBe("https://cdn.example.com/site/data/x.geojson");
    expect(resolveDocumentUrl("data/x.geojson", base)).toBe("https://cdn.example.com/site/data/x.geojson");
    expect(resolveDocumentUrl("/site/data/x.geojson", base)).toBe("https://cdn.example.com/site/data/x.geojson");
  });

  it("without a base nothing changes", () => {
    for (const base of [undefined, null, ""]) {
      expect(resolveDocumentUrl("data/x.geojson", base)).toBe("data/x.geojson");
      expect(resolveDocumentUrl("/data/x.geojson", base)).toBe("/data/x.geojson");
    }
  });

  it("passes non-strings and empty strings through", () => {
    expect(resolveDocumentUrl(undefined, "/r/")).toBeUndefined();
    expect(resolveDocumentUrl("", "/r/")).toBe("");
    const obj = { type: "FeatureCollection" };
    expect(resolveDocumentUrl(obj, "/r/")).toBe(obj);
  });

  it("is exported from the package root", () => {
    expect(core.resolveDocumentUrl).toBe(resolveDocumentUrl);
    expect(core.applyDocumentBase).toBe(applyDocumentBase);
    expect(core.normalizeDocumentBase).toBe(normalizeDocumentBase);
  });
});

function model(yaml: string): MapModel {
  const result = YAMLParser.safeParseMapBlock(yaml);
  if (!result.success) {
    throw new Error(
      "expected the document to parse, got errors:\n" +
        result.errors.map((e) => `${e.path}: ${e.message}`).join("\n")
    );
  }
  return toModel(result.data as never);
}

/** Every URL-bearing field of a v1 document, written the way a student would. */
const V1 = `
type: map
id: every-url
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "/styles/basemap.json"
sources:
  named:
    type: geojson
    url: "/data/named.geojson"
  stringData:
    type: geojson
    data: "/data/string-data.geojson"
  inlineData:
    type: geojson
    data:
      type: FeatureCollection
      features:
        - type: Feature
          properties: { url: "/not/a/document/url" }
          geometry: { type: Point, coordinates: [0, 0] }
  vectorTiles:
    type: vector
    tiles: ["/tiles/{z}/{x}/{y}.pbf", "https://tiles.example.com/{z}/{x}/{y}.pbf"]
  tileJson:
    type: raster
    url: "tiles/raster.json"
  overlay:
    type: image
    url: "images/overlay.png"
    coordinates: [[0, 1], [1, 1], [1, 0], [0, 0]]
  clip:
    type: video
    urls: ["/video/clip.mp4", "video/clip.webm"]
    coordinates: [[0, 1], [1, 1], [1, 0], [0, 0]]
  live:
    type: geojson
    url: "/data/live.geojson"
    stream:
      type: sse
      url: "/events"
layers:
  - id: inline
    type: circle
    source:
      type: geojson
      url: "data/inline.geojson"
    interactive:
      click:
        popup:
          - p:
              - str: "About"
                href: "/about/"
              - str: "Elsewhere"
                href: "https://example.com/x"
              - str: "Top"
                href: "#top"
      hover:
        popup:
          - p:
              - str: "Notes"
                href: "notes.html"
  - id: by-name
    type: circle
    source: named
legend:
  items:
    - color: "#f00"
      label: "Pins"
      shape: icon
      icon: "pin"
images:
  tri: "/images/tri.png"
  sdf:
    url: "images/sdf.png"
    sdf: true
  remote: "https://example.com/remote.png"
markers:
  - at: [0, 0]
    icon: "/images/pin.png"
    popup:
      - p:
          - str: "More"
            href: "/more/"
  - at: [1, 1]
popups:
  - at: [2, 2]
    content:
      - p:
          - str: "Read"
            href: "read.html"
`;

describe("applyDocumentBase — every URL field (v1)", () => {
  const before = model(V1);
  const after = applyDocumentBase(before, "/my-repo/");
  const config = denormalizeConfig(after);
  const sources = denormalizeSources(after) as Record<string, any>;
  const layers = denormalizeLayers(after) as any[];
  const options = denormalizeOptions(after) as Record<string, any>;

  it("mapStyle", () => {
    expect(config.mapStyle).toBe("/my-repo/styles/basemap.json");
  });

  it("named sources: url, data string, tiles, TileJSON url, image url, video urls, stream url", () => {
    expect(sources["named"].url).toBe("/my-repo/data/named.geojson");
    expect(sources["stringData"].data).toBe("/my-repo/data/string-data.geojson");
    expect(sources["vectorTiles"].tiles).toEqual([
      "/my-repo/tiles/{z}/{x}/{y}.pbf",
      "https://tiles.example.com/{z}/{x}/{y}.pbf",
    ]);
    expect(sources["tileJson"].url).toBe("/my-repo/tiles/raster.json");
    expect(sources["overlay"].url).toBe("/my-repo/images/overlay.png");
    expect(sources["clip"].urls).toEqual(["/my-repo/video/clip.mp4", "/my-repo/video/clip.webm"]);
    expect(sources["live"].url).toBe("/my-repo/data/live.geojson");
    expect(sources["live"].stream.url).toBe("/my-repo/events");
  });

  it("leaves inline GeoJSON (and the URLs in its properties) alone", () => {
    expect(sources["inlineData"].data).toBe(before.style.sources["inlineData"]!.spec["data"]);
    expect(sources["inlineData"].data.features[0].properties.url).toBe("/not/a/document/url");
  });

  it("inline layer sources and popup links", () => {
    expect(layers[0].source.url).toBe("/my-repo/data/inline.geojson");
    const click = layers[0].interactive.click.popup[0].p;
    expect(click.map((i: any) => i.href)).toEqual(["/my-repo/about/", "https://example.com/x", "#top"]);
    expect(layers[0].interactive.hover.popup[0].p[0].href).toBe("/my-repo/notes.html");
    expect(layers[1].source).toBe("named");
  });

  it("images, marker icons and popups", () => {
    expect(options["images"]).toEqual({
      tri: "/my-repo/images/tri.png",
      sdf: { url: "/my-repo/images/sdf.png", sdf: true },
      remote: "https://example.com/remote.png",
    });
    expect(options["markers"][0].icon).toBe("/my-repo/images/pin.png");
    expect(options["markers"][0].popup[0].p[0].href).toBe("/my-repo/more/");
    expect("icon" in options["markers"][1]).toBe(false);
    expect(options["popups"][0].content[0].p[0].href).toBe("/my-repo/read.html");
  });

  it("does not touch the legend icon (it is a name shown as text)", () => {
    expect(options["legend"].items[0].icon).toBe("pin");
  });

  it("never mutates its input", () => {
    expect(denormalizeConfig(before).mapStyle).toBe("/styles/basemap.json");
    expect(denormalizeSources(before)["named"]).toMatchObject({ url: "/data/named.geojson" });
    expect(before.runtime.markers![0]!.icon).toBe("/images/pin.png");
  });

  it("adds no keys: the rebased model has the same shape", () => {
    const keys = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(keys)
        : value && typeof value === "object"
          ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, keys(v)]))
          : typeof value;
    expect(keys(after)).toEqual(keys(before));
  });

  it("without a base returns the very same model", () => {
    for (const base of [undefined, null, ""]) {
      expect(applyDocumentBase(before, base)).toBe(before);
    }
  });

  it("a document already written with the base is unchanged", () => {
    const written = model(V1.replace(/"\/(styles|data|tiles|images|video|events|about|more)/g, '"/my-repo/$1'));
    const rebased = applyDocumentBase(written, "/my-repo/");
    expect(denormalizeConfig(rebased).mapStyle).toBe("/my-repo/styles/basemap.json");
    expect((denormalizeSources(rebased) as any)["named"].url).toBe("/my-repo/data/named.geojson");
    expect(rebased.runtime.markers![0]!.icon).toBe("/my-repo/images/pin.png");
  });
});

describe("applyDocumentBase — v2 documents and inline styles", () => {
  const V2 = `
version: 2
type: map
id: v2
style:
  basemap: "styles/basemap.json"
  center: [0, 0]
  zoom: 2
  images:
    tri: "/images/tri.png"
  sources:
    pts:
      type: geojson
      url: "/data/pts.geojson"
      runtime:
        refresh:
          refreshInterval: 60000
  layers:
    - id: pts
      type: circle
      source: pts
runtime:
  markers:
    - at: [0, 0]
      icon: "images/pin.png"
`;

  it("resolves the same fields in the v2 layout", () => {
    const after = applyDocumentBase(model(V2), "/my-repo");
    expect(after.style.basemap).toBe("/my-repo/styles/basemap.json");
    expect(after.style.images).toEqual({ tri: "/my-repo/images/tri.png" });
    expect(after.style.sources["pts"]!.spec["url"]).toBe("/my-repo/data/pts.geojson");
    expect(after.runtime.markers![0]!.icon).toBe("/my-repo/images/pin.png");
  });

  it("an inline basemap style: sprite, glyphs and its sources", () => {
    const m = model(`
type: map
id: inline-style
config:
  center: [0, 0]
  zoom: 2
  mapStyle:
    version: 8
    sprite: "/sprites/base"
    glyphs: "/fonts/{fontstack}/{range}.pbf"
    sources:
      land:
        type: geojson
        data: "data/land.geojson"
    layers: []
layers: []
`);
    const style = applyDocumentBase(m, "/my-repo/").style.basemap as Record<string, any>;
    expect(style["sprite"]).toBe("/my-repo/sprites/base");
    expect(style["glyphs"]).toBe("/my-repo/fonts/{fontstack}/{range}.pbf");
    expect(style["sources"].land.data).toBe("/my-repo/data/land.geojson");

    const multi = applyDocumentBase(
      { ...m, style: { ...m.style, basemap: { version: 8, sprite: [{ id: "a", url: "sprites/a" }] } } } as MapModel,
      "/my-repo/"
    ).style.basemap as Record<string, any>;
    expect(multi["sprite"]).toEqual([{ id: "a", url: "/my-repo/sprites/a" }]);
  });
});

describe("applyDocumentBaseToLayer (addLayer)", () => {
  it("resolves an added layer's inline source", () => {
    const layer = { id: "x", type: "circle", source: { type: "geojson", url: "data/x.geojson" } };
    expect(applyDocumentBaseToLayer(layer, "/my-repo/").source.url).toBe("/my-repo/data/x.geojson");
    expect(applyDocumentBaseToLayer(layer, null)).toBe(layer);
  });
});
