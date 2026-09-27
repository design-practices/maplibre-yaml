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
  dedupeAssets,
  finalizeSpriteBaseUrl,
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
    expect(a.name).toBe(b.name);
    expect(a.svg).toBe(b.svg);
  });

  it("differs when params differ, keeping the readable prefix", () => {
    const a = hatchTileSvg({ angle: 45, spacing: 8 }).name;
    const b = hatchTileSvg({ angle: 30, spacing: 8 }).name;
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
    const asset = hatchTileSvg();
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

  it("finalizes the sprite URL when a base is supplied", () => {
    const asset = hatchTileSvg();
    const result = attachSpriteAssets(emptyResult(), [asset], "https://maps.example.com/app/");
    expect(result.style["sprite"]).toEqual([
      { id: DOCUMENT_SPRITE_ID, url: `https://maps.example.com/app/${DOCUMENT_SPRITE_ID}` },
    ]);
  });

  it("accumulates across calls, deduping identical assets", () => {
    const asset = hatchTileSvg();
    const once = attachSpriteAssets(emptyResult(), [asset]);
    const twice = attachSpriteAssets(once, [asset]);
    expect(twice.assets).toHaveLength(1);
  });
});

describe("dedupeAssets / name collisions", () => {
  it("keeps one copy of identical content", () => {
    const asset = hatchTileSvg();
    expect(dedupeAssets([asset, { ...asset }])).toHaveLength(1);
  });

  it("throws when one name claims two different images", () => {
    const asset = hatchTileSvg();
    expect(() =>
      dedupeAssets([asset, { ...asset, svg: "<svg><!-- different --></svg>" }])
    ).toThrow(/claimed by two different images/);
  });

  it("buildSpriteIndex never packs a wider sheet than its index describes", () => {
    const asset = hatchTileSvg();
    const layout = buildSpriteIndex([asset, { ...asset }]);
    expect(layout.placements).toHaveLength(1);
    expect(layout.width).toBe(asset.width);
  });
});

describe("assets survive the runtime gate", () => {
  it("applyRuntimeGate's rebuild carries EmitResult.assets through", async () => {
    const { applyRuntimeGate } = await import("../../src/emitter/modes");
    const asset = hatchTileSvg();
    const attached = attachSpriteAssets(
      emptyResult({ state: { minPop: { default: 5 } } }),
      [asset]
    );
    // Below the state floor the gate inlines defaults and REBUILDS the
    // result — assets must ride the spread, not vanish.
    const gated = applyRuntimeGate(attached, { trust: "trusted", target: "4.0.0" });
    expect(gated.assets).toEqual([asset]);
  });
});

describe("finalizeSpriteBaseUrl", () => {
  it("rewrites only the relative placeholder entry", () => {
    const style = {
      sprite: [
        { id: "default", url: "https://base.example/sprite" },
        { id: DOCUMENT_SPRITE_ID, url: DOCUMENT_SPRITE_ID },
      ],
    };
    const out = finalizeSpriteBaseUrl(style, "https://maps.example.com/app");
    expect(out["sprite"]).toEqual([
      { id: "default", url: "https://base.example/sprite" },
      { id: DOCUMENT_SPRITE_ID, url: `https://maps.example.com/app/${DOCUMENT_SPRITE_ID}` },
    ]);
  });

  it("leaves styles without an array sprite untouched", () => {
    const style = { sprite: "https://base.example/sprite" };
    expect(finalizeSpriteBaseUrl(style, "https://x.example")).toEqual(style);
  });
});

describe("hatch tile seamlessness (lattice snap)", () => {
  it("snaps (angle, spacing) so the stroke family is periodic over the tile", () => {
    // 45°/8px/32px: 32·sin45 ≈ 22.6 is NOT a multiple of 8 — unsnapped, every
    // stroke jogs at the tile boundary. The snap picks j=k=3 crossings.
    const asset = hatchTileSvg({ angle: 45, spacing: 8, size: 32 });
    const rotate = asset.svg.match(/rotate\(([-\d.]+)/);
    expect(rotate).not.toBeNull();
    expect(Number(rotate![1])).toBeCloseTo(45, 5);
    // spacing' = 32 / hypot(3,3) ≈ 7.5425 — read back from the line offsets.
    const offsets = [...asset.svg.matchAll(/y1="([-\d.]+)"/g)].map((m) => Number(m[1]));
    const step = offsets[1]! - offsets[0]!;
    expect(step).toBeCloseTo(32 / Math.hypot(3, 3), 3);
  });

  it("angle 0 and 90 survive the snap", () => {
    expect(() => hatchTileSvg({ angle: 0 })).not.toThrow();
    expect(() => hatchTileSvg({ angle: 90 })).not.toThrow();
  });
});

describe("basemap sprite merge (KTD3 prefixing)", () => {
  const asset = hatchTileSvg();

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
