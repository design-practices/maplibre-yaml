/**
 * Spec-derived paint/layout key allowlist (ml-chh.11).
 *
 * The curated zod shapes are a typed subset of the style spec, and
 * `mlym validate` promotes unknown-key warnings to errors in CI — so a
 * correct document using a spec key outside the curated lists failed strict
 * validation. The walker now consults the generated spec key sets: real spec
 * keys never warn; typos still do, hinting against the full spec pool.
 */
import { describe, it, expect } from "vitest";
import { latest } from "@maplibre/maplibre-gl-style-spec";
import { YAMLParser } from "../../src/parser/yaml-parser";
import {
  SPEC_PAINT_KEYS,
  SPEC_LAYOUT_KEYS,
} from "../../src/parser/spec-keys.generated";

/** Build a minimal valid map block, optionally overriding the layer. */
function mapBlock(layer: string): string {
  return `type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers:
${layer}
`;
}

describe("spec-keys.generated stays in sync with the installed style spec", () => {
  it("matches a fresh recomputation from @maplibre/maplibre-gl-style-spec", () => {
    const paint = new Set<string>();
    const layout = new Set<string>();
    for (const type of Object.keys((latest as any).layer.type.values)) {
      for (const k of Object.keys((latest as any)[`paint_${type}`] ?? {})) paint.add(k);
      for (const k of Object.keys((latest as any)[`layout_${type}`] ?? {})) layout.add(k);
    }
    // Stale after a dep bump → rerun: node scripts/generate-spec-keys.mjs
    expect([...SPEC_PAINT_KEYS].sort()).toEqual([...paint].sort());
    expect([...SPEC_LAYOUT_KEYS].sort()).toEqual([...layout].sort());
  });
});

describe("spec keys outside the curated shapes do not warn", () => {
  it("accepts v5 hillshade paint keys without unknown-key warnings", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: relief
    type: hillshade
    source: { type: raster-dem, url: "https://example.com/dem.json" }
    paint:
      hillshade-method: igor
      hillshade-illumination-altitude: 30`)
    );
    expect(result.success).toBe(true);
    expect(result.warnings.filter((w) => /Unknown key/.test(w.message))).toEqual([]);
  });

  it("accepts text-variable-anchor-offset in symbol layout", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: labels
    type: symbol
    source: { type: geojson, url: "https://example.com/d.geojson" }
    layout:
      text-field: ["get", "name"]
      text-variable-anchor-offset: ["top", [0, 1]]`)
    );
    expect(result.success).toBe(true);
    expect(result.warnings.filter((w) => /Unknown key/.test(w.message))).toEqual([]);
  });

  it("accepts visibility in a line layer's layout", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: l
    type: line
    source: { type: geojson, url: "https://example.com/d.geojson" }
    layout:
      visibility: visible`)
    );
    expect(result.success).toBe(true);
    expect(result.warnings.filter((w) => /Unknown key/.test(w.message))).toEqual([]);
  });

  it("still warns on a typo'd paint key, hinting from the spec pool", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: geojson, url: "https://example.com/d.geojson" }
    paint:
      circle-radis: 8`)
    );
    expect(result.success).toBe(true);
    const w = result.warnings.find((x) => /Unknown key "circle-radis"/.test(x.message));
    expect(w).toBeDefined();
    expect(w!.message).toContain('Did you mean "circle-radius"?');
  });

  it("still warns on a key that is in no spec at all", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: geojson, url: "https://example.com/d.geojson" }
    paint:
      totally-made-up-property: 8`)
    );
    expect(result.success).toBe(true);
    expect(
      result.warnings.some((x) => /Unknown key "totally-made-up-property"/.test(x.message))
    ).toBe(true);
  });

  it("does not treat spec keys as known outside paint/layout position", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: geojson, url: "https://example.com/d.geojson" }
    circle-radius: 8`)
    );
    expect(result.success).toBe(true);
    expect(
      result.warnings.some((x) => /Unknown key "circle-radius"/.test(x.message))
    ).toBe(true);
  });
});
