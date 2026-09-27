/**
 * @file `images:` eject — refs on the result, mlym: rewriting, sprite root (U6, R9)
 */

import { describe, it, expect } from "vitest";
import { projectStyle } from "../../src/emitter/project";
import { attachSpriteImages, DOCUMENT_SPRITE_ID } from "../../src/emitter/assets";
import { lowerMarkers } from "../../src/emitter/lower-markers";
import { normalizeMapBlock } from "../../src/model/normalize";
import { ejectClasses } from "../../src/eject/registrations";
import type { V1MapInput } from "../../src/model/types";

const doc = (images: unknown, layers: unknown[] = []) =>
  normalizeMapBlock({
    id: "iconic",
    config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" },
    sources: {
      pois: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers,
    images,
  } as unknown as V1MapInput);

const IMAGES = {
  "poi-icon": "https://x.example/poi.png",
  arrow: { url: "https://x.example/arrow.png", sdf: true, pixelRatio: 2 },
};

describe("projectStyle with images:", () => {
  it("carries fetch-at-emit refs on the result and declares the document sprite", () => {
    const result = projectStyle(doc(IMAGES));

    expect(result.images).toEqual([
      { name: "poi-icon", url: "https://x.example/poi.png" },
      { name: "arrow", url: "https://x.example/arrow.png", sdf: true, pixelRatio: 2 },
    ]);
    expect(result.style["sprite"]).toEqual([
      { id: DOCUMENT_SPRITE_ID, url: DOCUMENT_SPRITE_ID },
    ]);
    // Fully compiles — nothing lossy, strict accepts it.
    expect(() => projectStyle(doc(IMAGES), "strict")).not.toThrow();
  });

  it("rewrites literal image references to the mlym: namespace", () => {
    const result = projectStyle(
      doc(IMAGES, [
        {
          id: "pois",
          type: "symbol",
          source: "pois",
          layout: { "icon-image": "poi-icon", "text-field": "poi-icon" },
        },
        {
          id: "zones",
          type: "fill",
          source: "pois",
          paint: { "fill-pattern": "arrow" },
        },
      ])
    );

    const [pois, zones] = result.style["layers"] as Record<string, any>[];
    expect(pois!["layout"]["icon-image"]).toBe("mlym:poi-icon");
    // Only image-valued properties rewrite — a label that happens to match
    // an image name is author text, not a reference.
    expect(pois!["layout"]["text-field"]).toBe("poi-icon");
    expect(zones!["paint"]["fill-pattern"]).toBe("mlym:arrow");
  });

  it("rewrites matching string literals inside expressions", () => {
    const result = projectStyle(
      doc(IMAGES, [
        {
          id: "pois",
          type: "symbol",
          source: "pois",
          layout: {
            "icon-image": ["match", ["get", "kind"], "poi", "poi-icon", "arrow"],
          },
        },
      ])
    );
    const [pois] = result.style["layers"] as Record<string, any>[];
    expect(pois!["layout"]["icon-image"]).toEqual([
      "match",
      ["get", "kind"],
      "poi",
      "mlym:poi-icon",
      "mlym:arrow",
    ]);
  });

  it("a document without images has no refs and no sprite", () => {
    const result = projectStyle(doc(undefined));
    expect(result.images).toBeUndefined();
    expect(result.style["sprite"]).toBeUndefined();
  });

  it("images is registered as class ejects", () => {
    expect(ejectClasses.require("images").class).toBe("ejects");
  });
});

describe("marker icon embedding (U6 lifts the U5 icon fallback)", () => {
  const markerDoc = (markers: unknown) =>
    normalizeMapBlock({
      id: "pins",
      config: { center: [0, 0], zoom: 2, mapStyle: "https://example.com/style.json" },
      layers: [],
      markers,
    } as unknown as V1MapInput);

  it("http(s) icon markers emit an image ref instead of a lossy pin substitution", () => {
    const { images, assets, warnings, model } = lowerMarkers(
      markerDoc([{ at: [0, 0], icon: "https://x.example/pin.png" }, { at: [1, 1] }])
    );

    expect(images).toHaveLength(1);
    expect(images[0]!.url).toBe("https://x.example/pin.png");
    expect(assets).toHaveLength(1); // only the plain marker's pin
    expect(warnings.find((w) => w.path.endsWith(".icon"))).toBeUndefined();

    const source = model.style.sources["mlym-markers"]!.spec as any;
    const [iconFeature, pinFeature] = source.data.features;
    expect(iconFeature.properties["mlym:icon"]).toBe(images[0]!.name);
    // Icons anchor center (the live DOM default); pins anchor at their tip.
    expect(iconFeature.properties["mlym:anchor"]).toBe("center");
    expect(pinFeature.properties["mlym:anchor"]).toBe("bottom");
    const layout = (model.style.layers.at(-1)!.spec as any).layout;
    expect(layout["icon-anchor"]).toEqual(["get", "mlym:anchor"]);
  });

  it("pin-only documents keep the constant bottom anchor", () => {
    const { model } = lowerMarkers(markerDoc([{ at: [0, 0] }]));
    const layout = (model.style.layers.at(-1)!.spec as any).layout;
    expect(layout["icon-anchor"]).toBe("bottom");
  });

  it("an unfetchable icon scheme still falls back to the pin, said out loud", () => {
    const { images, warnings } = lowerMarkers(
      markerDoc([{ at: [0, 0], icon: "./relative/pin.png" }])
    );
    expect(images).toHaveLength(0);
    const warning = warnings.find((w) => w.path === "markers[0].icon");
    expect(warning?.kind).toBe("lossy");
    expect(warning?.message).toMatch(/default pin/);
  });

  it("the same icon URL twice yields one deduped ref", () => {
    const { model, images } = lowerMarkers(
      markerDoc([
        { at: [0, 0], icon: "https://x.example/pin.png" },
        { at: [1, 1], icon: "https://x.example/pin.png" },
      ])
    );
    expect(new Set(images.map((i) => i.name)).size).toBe(1);
    const attached = attachSpriteImages(projectStyle(model), images);
    expect(attached.images).toHaveLength(1);
  });
});

describe("attachSpriteImages", () => {
  const base = () => projectStyle(doc(undefined));

  it("declares the sprite root and records deduped refs", () => {
    const result = attachSpriteImages(base(), [
      { name: "a", url: "https://x.example/a.png" },
      { name: "a", url: "https://x.example/a.png" },
    ]);
    expect(result.images).toHaveLength(1);
    expect(result.style["sprite"]).toEqual([
      { id: DOCUMENT_SPRITE_ID, url: DOCUMENT_SPRITE_ID },
    ]);
  });

  it("throws on a name claimed by two different URLs", () => {
    expect(() =>
      attachSpriteImages(base(), [
        { name: "a", url: "https://x.example/a.png" },
        { name: "a", url: "https://x.example/b.png" },
      ])
    ).toThrow(/claimed by two different URLs/);
  });

  it("attaching no refs is a no-op", () => {
    const before = base();
    expect(attachSpriteImages(before, [])).toBe(before);
  });
});
