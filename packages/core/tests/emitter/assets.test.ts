/**
 * @file Sprite asset descriptors + index assembly (U4, R7)
 */

import { describe, it, expect } from "vitest";
import {
  assetName,
  contentHash8,
  hatchTileSvg,
  buildSpriteIndex,
  attachSpriteAssets,
  DOCUMENT_SPRITE_ID,
} from "../../src/emitter/assets";
import { mergeBasemap } from "../../src/emitter/basemap";
import type { EmitResult } from "../../src/emitter/project";

const emptyResult = (style: Record<string, unknown> = {}): EmitResult => ({
  style: { version: 8, sources: {}, layers: [], ...style },
  warnings: [],
  placements: [],
});

describe("asset naming (KTD6)", () => {
  it("is deterministic: same inputs, same name", () => {
    const a = hatchTileSvg({ angle: 45, spacing: 8 });
    const b = hatchTileSvg({ angle: 45, spacing: 8 });
    expect(a.asset.name).toBe(b.asset.name);
    expect(a.asset.svg).toBe(b.asset.svg);
  });

  it("differs when params differ, keeping the readable prefix", () => {
    const a = hatchTileSvg({ angle: 45, spacing: 8 }).asset.name;
    const b = hatchTileSvg({ angle: 30, spacing: 8 }).asset.name;
    expect(a).not.toBe(b);
    expect(a).toMatch(/^fx-hatch-45-8-[0-9a-f]{8}$/);
    expect(b).toMatch(/^fx-hatch-30-8-[0-9a-f]{8}$/);
  });

  it("hash is content-derived and stable", () => {
    expect(contentHash8("abc")).toBe(contentHash8("abc"));
    expect(contentHash8("abc")).not.toBe(contentHash8("abd"));
    expect(assetName("pin", ["red"], "<svg/>")).toBe(
      `fx-pin-red-${contentHash8("<svg/>")}`
    );
  });
});

describe("sprite index layout", () => {
  const assets = [
    { name: "b-tile", svg: "<svg/>", width: 32, height: 32 },
    { name: "a-pin", svg: "<svg/>", width: 24, height: 36 },
  ];

  it("packs deterministically, sorted by name", () => {
    const layout = buildSpriteIndex(assets);
    expect(Object.keys(layout.index)).toEqual(["a-pin", "b-tile"]);
    expect(layout.index["a-pin"]).toEqual({ x: 0, y: 0, width: 24, height: 36, pixelRatio: 1 });
    expect(layout.index["b-tile"]).toEqual({ x: 24, y: 0, width: 32, height: 32, pixelRatio: 1 });
    expect(layout.width).toBe(56);
    expect(layout.height).toBe(36);
  });

  it("scales everything by pixelRatio for the @2x sheet", () => {
    const layout = buildSpriteIndex(assets, 2);
    expect(layout.index["a-pin"]).toEqual({ x: 0, y: 0, width: 48, height: 72, pixelRatio: 2 });
    expect(layout.width).toBe(112);
  });
});

describe("attachSpriteAssets", () => {
  it("declares the document sprite in array form and carries descriptors", () => {
    const { asset } = hatchTileSvg();
    const result = attachSpriteAssets(emptyResult(), [asset]);
    expect(result.style["sprite"]).toEqual([
      { id: DOCUMENT_SPRITE_ID, url: DOCUMENT_SPRITE_ID },
    ]);
    expect(result.assets).toEqual([asset]);
  });

  it("is a no-op for zero assets", () => {
    const result = emptyResult();
    expect(attachSpriteAssets(result, [])).toBe(result);
  });
});

describe("basemap sprite merge (KTD3 prefixing)", () => {
  const { asset } = hatchTileSvg();

  it("string basemap sprite becomes `default`, document assets keep `mlym` — both survive", () => {
    const projected = attachSpriteAssets(emptyResult(), [asset]);
    const merged = mergeBasemap(
      { version: 8, sprite: "https://base.example/sprite", sources: {}, layers: [] },
      projected
    );
    expect(merged.style["sprite"]).toEqual([
      { id: "default", url: "https://base.example/sprite" },
      { id: DOCUMENT_SPRITE_ID, url: DOCUMENT_SPRITE_ID },
    ]);
    expect(merged.assets).toEqual([asset]);
  });

  it("array basemap sprite appends the document entry", () => {
    const projected = attachSpriteAssets(emptyResult(), [asset]);
    const merged = mergeBasemap(
      {
        version: 8,
        sprite: [{ id: "default", url: "https://base.example/sprite" }],
        sources: {},
        layers: [],
      },
      projected
    );
    expect((merged.style["sprite"] as unknown[]).length).toBe(2);
    expect(merged.warnings).toEqual([]);
  });

  it("id collision warns lossy and the document wins", () => {
    const projected = attachSpriteAssets(emptyResult(), [asset]);
    const merged = mergeBasemap(
      {
        version: 8,
        sprite: [{ id: DOCUMENT_SPRITE_ID, url: "https://base.example/theirs" }],
        sources: {},
        layers: [],
      },
      projected
    );
    expect(merged.style["sprite"]).toEqual([
      { id: DOCUMENT_SPRITE_ID, url: DOCUMENT_SPRITE_ID },
    ]);
    const warning = merged.warnings.find((w) => w.path === `sprite.${DOCUMENT_SPRITE_ID}`);
    expect(warning?.kind).toBe("lossy");
  });

  it("basemap sprite passes through untouched when the document has no assets", () => {
    const merged = mergeBasemap(
      { version: 8, sprite: "https://base.example/sprite", sources: {}, layers: [] },
      emptyResult()
    );
    expect(merged.style["sprite"]).toBe("https://base.example/sprite");
  });
});
