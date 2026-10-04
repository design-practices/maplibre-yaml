import { describe, it, expect } from "vitest";
import { absolutizeTileTemplate, absolutizeVectorTiles } from "../../src/utils/tile-url";

const BASE = "https://maps.example.com/app/page.html";

describe("absolutizeTileTemplate", () => {
  it("resolves root- and dot-relative templates, keeping {z}/{x}/{y} braces", () => {
    expect(absolutizeTileTemplate("/tiles/{z}/{x}/{y}.pbf", BASE)).toBe(
      "https://maps.example.com/tiles/{z}/{x}/{y}.pbf"
    );
    expect(absolutizeTileTemplate("./t/{z}/{x}/{y}.pbf?k={key}", BASE)).toBe(
      "https://maps.example.com/app/t/{z}/{x}/{y}.pbf?k={key}"
    );
    expect(absolutizeTileTemplate("../t/{z}/{x}/{y}.pbf", BASE)).toBe(
      "https://maps.example.com/t/{z}/{x}/{y}.pbf"
    );
  });

  it("leaves absolute and scheme-bearing templates untouched", () => {
    for (const t of [
      "https://tiles.example.com/{z}/{x}/{y}.pbf",
      "pmtiles://https://x.example/a.pmtiles",
      "mbtiles://{z}/{x}/{y}",
    ]) {
      expect(absolutizeTileTemplate(t, BASE)).toBe(t);
    }
  });

  it("is a no-op without a base (outside a browser)", () => {
    expect(absolutizeTileTemplate("/tiles/{z}/{x}/{y}.pbf", "")).toBe(
      "/tiles/{z}/{x}/{y}.pbf"
    );
  });

  it("defaults to document.baseURI in the browser", () => {
    expect(absolutizeTileTemplate("/t/{z}/{x}/{y}.pbf")).toBe(
      new URL("/t/", document.baseURI).href + "{z}/{x}/{y}.pbf"
    );
  });
});

describe("absolutizeVectorTiles", () => {
  it("rewrites a vector source's tiles and nothing else", () => {
    const out = absolutizeVectorTiles({
      type: "vector",
      tiles: ["/t/{z}/{x}/{y}.pbf"],
      maxzoom: 14,
    });
    expect(out.tiles).toEqual([new URL("/t/", document.baseURI).href + "{z}/{x}/{y}.pbf"]);
    expect(out.maxzoom).toBe(14);
  });

  it("passes other source types through (raster tiles load on the main thread)", () => {
    const raster = { type: "raster", tiles: ["/r/{z}/{x}/{y}.png"] };
    expect(absolutizeVectorTiles(raster)).toBe(raster);
  });
});
