/**
 * Error-quality regression corpus.
 *
 * Each fixture under tests/fixtures/error-corpus is a deliberately-broken YAML
 * document. This suite locks in the *quality* of the first surfaced error —
 * its `{ line, column, message }` — so error ergonomics cannot silently regress.
 * When these expectations change, that is a reviewable product-surface change.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { YAMLParser } from "../../src/parser/yaml-parser";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/error-corpus"
);

interface Expectation {
  file: string;
  blockType: "map" | "scrollytelling" | "root" | "unknown";
  path: string;
  line?: number;
  column?: number;
  messageContains: string;
}

const CORPUS: Expectation[] = [
  {
    file: "invalid-longitude.yaml",
    blockType: "root",
    path: "pages.0.blocks.0.config.center.0",
    line: 8,
    column: 20,
    messageContains: "Value must be <= 180",
  },
  {
    file: "bad-zoom.yaml",
    blockType: "map",
    path: "config.zoom",
    line: 5,
    column: 9,
    messageContains: "Value must be <= 24",
  },
  {
    file: "title-wrong-type.yaml",
    blockType: "root",
    path: "pages.0.title",
    line: 3,
    column: 12,
    messageContains: "Expected string, got number",
  },
  {
    file: "unknown-layer-type.yaml",
    blockType: "map",
    path: "layers.0",
    line: 8,
    column: 5,
    messageContains:
      'Unknown layer type "circl". Valid types: circle, line, fill, symbol, raster, fill-extrusion, heatmap, hillshade, background. Did you mean "circle"?',
  },
  {
    file: "unknown-source-type.yaml",
    blockType: "root",
    path: "sources.quakes",
    line: 3,
    column: 5,
    messageContains:
      'Unknown source type "geojsn". Valid types: geojson, vector, raster, image, video. Did you mean "geojson"?',
  },
  {
    file: "missing-map-config.yaml",
    blockType: "map",
    path: "config",
    line: 1,
    column: 1,
    messageContains: "Expected object, got undefined",
  },
  {
    file: "syntax-unterminated-string.yaml",
    blockType: "unknown",
    path: "",
    line: 5,
    column: 1,
    messageContains: "YAML syntax error",
  },
];

describe("error-corpus (regression suite for error quality)", () => {
  for (const expected of CORPUS) {
    it(`${expected.file} → ${expected.messageContains.slice(0, 40)}`, () => {
      const content = readFileSync(join(fixturesDir, expected.file), "utf-8");
      const { blockType, result } = YAMLParser.safeParseAny(content);

      expect(blockType).toBe(expected.blockType);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      const first = result.errors[0];
      expect(first.path).toBe(expected.path);
      expect(first.message).toContain(expected.messageContains);
      expect(first.line).toBe(expected.line);
      expect(first.column).toBe(expected.column);
    });
  }
});
