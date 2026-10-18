/**
 * Expression operators come from the installed style spec, not a hand list.
 *
 * The hand-written operator list lagged MapLibre: `split`, `join`
 * (maplibre-gl 5.20+), `elevation` and `semiliteral` warned as "Unknown
 * expression operator", and `mlym validate` promotes warnings to errors under
 * CI, so a valid document failed validation and builds. The list is now
 * generated from @maplibre/maplibre-gl-style-spec's expression registry (the
 * ml-chh.11 pattern for paint/layout keys); the drift test fails when the
 * spec gains an operator the generated file lacks.
 */
import { describe, it, expect } from "vitest";
import { expressions } from "@maplibre/maplibre-gl-style-spec";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { EXPRESSION_OPERATORS } from "../../src/parser/validation-utils";

const doc = (expr: string) => `type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers:
  - id: labels
    type: symbol
    source: { type: geojson, url: "https://example.com/d.geojson" }
    layout:
      text-field: ${expr}
`;

describe("expression operators from the style spec", () => {
  it("every operator in the installed spec's registry is known (drift check)", () => {
    const missing = Object.keys(expressions)
      .filter((op) => !op.startsWith("filter-")) // MapLibre-internal forms
      .filter((op) => !EXPRESSION_OPERATORS.has(op));
    // Stale after a dep bump -> rerun: node scripts/generate-spec-keys.mjs
    expect(missing).toEqual([]);
  });

  it.each([
    ["split", '["at", 0, ["split", ["get", "name"], " "]]'],
    ["join", '["join", ["literal", ["a", "b"]], ", "]'],
    ["elevation", '["to-string", ["elevation"]]'],
    ["semiliteral", '["semiliteral", "x"]'],
  ])("%s gives no warning at all (strict CI promotes any)", (_op, expr) => {
    const result = YAMLParser.safeParseMapBlock(doc(expr));
    expect(result.success).toBe(true);
    expect(result.warnings.map((w) => w.message)).toEqual([]);
  });

  it("legacy filter operators stay known; a typo still warns with a did-you-mean", () => {
    for (const op of ["!in", "!has", "none"]) expect(EXPRESSION_OPERATORS.has(op)).toBe(true);
    const result = YAMLParser.safeParseMapBlock(doc('["concatt", "a", "b"]'));
    expect(result.warnings.some((w) => /Unknown expression operator "concatt"/.test(w.message) && /concat/.test(w.message))).toBe(true);
  });
});
