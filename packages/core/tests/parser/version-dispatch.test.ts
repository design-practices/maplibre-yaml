import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { toModel } from "../../src/model/to-model";
import { normalizeMapBlock } from "../../src/model/normalize";
import type { V1MapInput } from "../../src/model/types";

/**
 * U1 — the version-dispatch seam.
 *
 * @remarks
 * The parser still returns a RAW `MapBlock`; the v1/v2 fork lives at
 * {@link toModel}, which the consumers (`ml-map.ts`, `emit.ts`) call instead of
 * `normalizeMapBlock`. Version detection runs inside `safeParseMapBlock` on a
 * SINGLE materialized value — after `toJSSafe`, so the merge-fan-out DoS guard
 * covers the detection path.
 */
describe("version dispatch (U1)", () => {
  const v1Map = (versionLine = "") => `
type: map
id: dispatch${versionLine ? "\n" + versionLine : ""}
config:
  center: [0, 0]
  zoom: 5
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers:
  - id: pts
    type: circle
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
`;

  it("parses a v1 doc with no version and toModel matches normalizeMapBlock", () => {
    const result = YAMLParser.safeParseMapBlock(v1Map());
    expect(result.success).toBe(true);
    const block = result.data!;
    expect(toModel(block as never)).toEqual(
      normalizeMapBlock(block as unknown as V1MapInput)
    );
  });

  it("accepts explicit `version: 1` identically, with no unknown-key warning", () => {
    const withVersion = YAMLParser.safeParseMapBlock(v1Map("version: 1"));
    const without = YAMLParser.safeParseMapBlock(v1Map());
    expect(withVersion.success).toBe(true);
    // `version` is a known key on v1 now: no unknown-key noise.
    expect(withVersion.warnings.map((w) => w.message).join(" ")).not.toMatch(
      /version/i
    );
    // Same model either way (drop the version tag before comparing shape).
    const a = withVersion.data as Record<string, unknown>;
    const b = without.data as Record<string, unknown>;
    expect(a.version).toBe(1);
    const { version: _v, ...rest } = a;
    expect(rest).toEqual(b);
  });

  it("routes `version: 2` to the v2 schema (U2 replaced the stub)", () => {
    // The v2 branch now validates against MapBlockV2Schema. A v1-SHAPED doc
    // (with `config:`, no `style:`) tagged `version: 2` is dispatched there and
    // fails the v2 shape — the stub "not yet implemented" message is gone.
    const result = YAMLParser.safeParseMapBlock(v1Map("version: 2"));
    expect(result.success).toBe(false);
    const message = result.errors.map((e) => e.message).join(" ");
    expect(message).not.toMatch(/not yet implemented/i);
    // The v2 schema requires a `style:` object; the v1 doc has none.
    expect(result.errors.some((e) => e.path.startsWith("style"))).toBe(true);
  });

  it("rejects a version above the ceiling, naming the version and the max", () => {
    const result = YAMLParser.safeParseMapBlock(v1Map("version: 99"));
    expect(result.success).toBe(false);
    const message = result.errors.map((e) => e.message).join(" ");
    expect(message).toMatch(/99/);
    expect(message).toMatch(/version 2/i);
  });

  it("rejects a string version rather than coercing it", () => {
    const result = YAMLParser.safeParseMapBlock(v1Map('version: "2"'));
    expect(result.success).toBe(false);
    const message = result.errors.map((e) => e.message).join(" ");
    expect(message).toMatch(/integer 1 or 2/i);
    // Not routed to the v2 stub — a coercing discriminator is the bug we guard.
    expect(message).not.toMatch(/not yet implemented/i);
  });

  it("rejects a non-integer numeric version rather than coercing it", () => {
    const result = YAMLParser.safeParseMapBlock(v1Map("version: 2.5"));
    expect(result.success).toBe(false);
    expect(result.errors.map((e) => e.message).join(" ")).toMatch(
      /integer 1 or 2/i
    );
  });

  it("catches a merge-fan-out DoS under version: 2 before detection, within a wall-clock bound", () => {
    // Materialization runs through toJSSafe (the fan-out guard) BEFORE version
    // detection reads the tag, so a v2-tagged bomb is rejected by the guard, not
    // expanded. Mirrors the seq-merge shape from yaml-parser.test.ts.
    let s = "type: map\nid: bomb\nversion: 2\na0: &a0 { k: v }\n";
    for (let i = 1; i <= 6; i++) {
      const items = Array.from({ length: 9 }, () => `*a${i - 1}`).join(",");
      s += `a${i}: &a${i}\n  <<: [${items}]\n`;
    }
    s += "layers: []\n";

    const started = performance.now();
    const result = YAMLParser.safeParseMapBlock(s);
    const elapsed = performance.now() - started;

    expect(result.success).toBe(false);
    expect(result.errors[0]?.code).toBe("yaml-expansion");
    // Never reached version detection or the v2 stub.
    expect(result.errors.map((e) => e.message).join(" ")).not.toMatch(
      /not yet implemented/i
    );
    // Unguarded this fan-out took ~13s; the guard runs on the AST.
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("toModel (U3 replaced the v2 stub)", () => {
  it("routes a version: 2 block to readV2Block, producing a model", () => {
    const model = toModel({
      version: 2,
      type: "map",
      id: "v2",
      style: { basemap: "https://demotiles.maplibre.org/style.json" },
    } as never);
    expect(model.id).toBe("v2");
    expect(model.style.basemap).toBe(
      "https://demotiles.maplibre.org/style.json"
    );
  });
});
