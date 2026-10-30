/**
 * @file ml-xjk: `__proto__` and `constructor` are ordinary keys to the unknown-key check.
 *
 * The walk looked a key up in the schema's shape with `shape[key]`, so
 * `constructor` found `Object.prototype.constructor` and `__proto__` found
 * `Object.prototype`: both read as known, and a typo-shaped key there was
 * silent. Each format, at the root and nested in a layer, warns at the key.
 */

import { describe, it, expect } from "vitest";
import { parseDocumentText } from "../../src";

const STYLE = "https://demotiles.maplibre.org/style.json";

/** The same map in each format, with `extra` written at the root or in the layer. */
const docs = (key: string, where: "root" | "layer") => ({
  yaml: [
    "type: map",
    "id: m",
    ...(where === "root" ? [`${key}: 1`] : []),
    `config: { center: [0, 0], zoom: 2, mapStyle: "${STYLE}" }`,
    "layers:",
    "  - id: a",
    "    type: circle",
    ...(where === "layer" ? [`    ${key}: 1`] : []),
    "    source: { type: geojson, data: { type: FeatureCollection, features: [] } }",
    "",
  ].join("\n"),
  json: [
    "{",
    '  "type": "map",',
    '  "id": "m",',
    ...(where === "root" ? [`  "${key}": 1,`] : []),
    `  "config": { "center": [0, 0], "zoom": 2, "mapStyle": "${STYLE}" },`,
    '  "layers": [',
    "    {",
    '      "id": "a",',
    '      "type": "circle",',
    ...(where === "layer" ? [`      "${key}": 1,`] : []),
    '      "source": { "type": "geojson", "data": { "type": "FeatureCollection", "features": [] } }',
    "    }",
    "  ]",
    "}",
    "",
  ].join("\n"),
  toml: [
    'type = "map"',
    'id = "m"',
    ...(where === "root" ? [`${key} = 1`] : []),
    "",
    "[config]",
    "center = [0, 0]",
    "zoom = 2",
    `mapStyle = "${STYLE}"`,
    "",
    "[[layers]]",
    'id = "a"',
    'type = "circle"',
    ...(where === "layer" ? [`${key} = 1`] : []),
    'source = { type = "geojson", data = { type = "FeatureCollection", features = [] } }',
    "",
  ].join("\n"),
});

/** Where `key` is written in `text`: 1-based line and column of its first character. */
function keyAt(text: string, key: string): { line: number; column: number } {
  const lines = text.split("\n");
  const line = lines.findIndex((l) => new RegExp(`^\\s*"?${key}"?\\s*[:=]`).test(l));
  return { line: line + 1, column: lines[line]!.search(/\S/) + 1 };
}

describe("ml-xjk: __proto__ and constructor are unknown keys like any other", () => {
  for (const key of ["__proto__", "constructor"]) {
    for (const where of ["root", "layer"] as const) {
      for (const [format, text] of Object.entries(docs(key, where))) {
        it(`${format}: ${key} in the ${where} warns at the key`, async () => {
          const before = Object.getOwnPropertyNames(Object.prototype).sort();
          const result = await parseDocumentText(text, { kind: "map", format: format as never });
          expect(result.errors).toEqual([]);
          const path = where === "root" ? key : `layers.0.${key}`;
          expect(result.warnings).toContainEqual(
            expect.objectContaining({ path, message: `Unknown key "${key}".`, ...keyAt(text, key) })
          );
          expect(Object.getOwnPropertyNames(Object.prototype).sort()).toEqual(before);
          expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
        });
      }
    }
  }

  it("a __proto__ table holding data pollutes nothing and is still reported", async () => {
    const text = `type: map\nid: m\n__proto__: { polluted: true }\nconfig: { center: [0, 0], zoom: 2, mapStyle: "${STYLE}" }\n`;
    const result = await parseDocumentText(text, { kind: "map", format: "yaml" });
    expect(result.success).toBe(true);
    expect(result.warnings.map((w) => w.path)).toContain("__proto__");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.getPrototypeOf(result.data)).toBe(Object.prototype);
    expect((result.data as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});
