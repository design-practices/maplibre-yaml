/**
 * Validation-ergonomics behaviours: line/column positions, the warnings
 * channel (unknown keys, deprecations, expression checks), discriminated-union
 * error messages, and root-level `$ref` source resolution.
 *
 * @see plans/feat-validation-ergonomics.md
 */
import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { levenshtein, suggest } from "../../src/parser/validation-utils";

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

describe("levenshtein / suggest", () => {
  it("computes edit distance", () => {
    expect(levenshtein("circle", "circle")).toBe(0);
    expect(levenshtein("circl", "circle")).toBe(1);
    expect(levenshtein("circle-radis", "circle-radius")).toBe(1);
    expect(levenshtein("abc", "xyz")).toBe(3);
  });

  it("suggests the nearest candidate within distance 2", () => {
    expect(suggest("circl", ["circle", "line", "fill"])).toBe("circle");
    expect(suggest("geojsn", ["geojson", "vector", "raster"])).toBe("geojson");
  });

  it("returns undefined when nothing is close enough", () => {
    expect(suggest("banana", ["circle", "line", "fill"])).toBeUndefined();
    expect(suggest("circle", ["circle"])).toBeUndefined(); // exact = no hint
  });
});

describe("line/column positions", () => {
  it("populates line/column for a Zod value error", () => {
    const result = YAMLParser.safeParse(`pages:
  - path: "/"
    title: "T"
    blocks:
      - type: map
        id: m
        config:
          center: [999, 40]
          zoom: 12
          mapStyle: "https://demotiles.maplibre.org/style.json"
`);
    expect(result.success).toBe(false);
    const err = result.errors.find((e) =>
      e.path.includes("center")
    );
    expect(err).toBeDefined();
    expect(err!.line).toBe(8);
    expect(err!.column).toBe(20);
  });

  it("populates line/column for YAML syntax errors", () => {
    const result = YAMLParser.safeParse(`pages:
  - path: "/"
    title: "unterminated
`);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain("YAML syntax error");
    // The yaml library reports the position where the unterminated token is
    // detected (end of input), which is at or beyond the opening line.
    expect(result.errors[0].line).toBeGreaterThanOrEqual(3);
    expect(typeof result.errors[0].column).toBe("number");
  });
});

describe("discriminated-union messages (product surface — snapshot)", () => {
  it("unknown layer type in a root layers record", () => {
    const result = YAMLParser.safeParse(`layers:
  l:
    id: l
    type: circl
    source: { type: geojson, url: "https://example.com/d.geojson" }
pages:
  - path: "/"
    title: "T"
    blocks: []
`);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toBe(
      'Unknown layer type "circl". Valid types: circle, line, fill, symbol, raster, fill-extrusion, heatmap, hillshade, background. Did you mean "circle"?'
    );
  });

  it("unknown layer type inside a block layers array", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circl
    source: { type: geojson, url: "https://example.com/d.geojson" }`)
    );
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toBe(
      'Unknown layer type "circl". Valid types: circle, line, fill, symbol, raster, fill-extrusion, heatmap, hillshade, background. Did you mean "circle"?'
    );
  });

  it("unknown source type", () => {
    const result = YAMLParser.safeParse(`sources:
  s:
    type: geojsn
    url: "https://example.com/d.geojson"
pages:
  - path: "/"
    title: "T"
    blocks: []
`);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toBe(
      'Unknown source type "geojsn". Valid types: geojson, vector, raster, image, video. Did you mean "geojson"?'
    );
  });

  it("unknown inline source type on a layer", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: geojsn, url: "https://example.com/d.geojson" }`)
    );
    expect(result.success).toBe(false);
    const err = result.errors.find((e) => e.message.includes("source type"));
    expect(err).toBeDefined();
    expect(err!.message).toBe(
      'Unknown source type "geojsn". Valid types: geojson, vector, raster, image, video. Did you mean "geojson"?'
    );
  });

  it("unknown block type via safeParseAny includes a did-you-mean", () => {
    const { blockType, result } = YAMLParser.safeParseAny(`type: mapp
id: x
`);
    expect(blockType).toBe("unknown");
    expect(result.errors[0].message).toContain('Unknown block type: "mapp"');
    expect(result.errors[0].message).toContain('Did you mean "map"?');
    expect(result.errors[0].suggestion).toBe("map");
  });
});

describe("warnings channel — unknown keys", () => {
  it("warns on an unknown paint key with a suggestion", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: geojson, url: "https://example.com/d.geojson" }
    paint:
      circle-radis: 8`)
    );
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toBe(
      'Unknown key "circle-radis". Did you mean "circle-radius"?'
    );
    expect(result.warnings[0].suggestion).toBe("circle-radius");
    expect(result.warnings[0].path).toBe("layers.0.paint.circle-radis");
    expect(typeof result.warnings[0].line).toBe("number");
    expect(typeof result.warnings[0].column).toBe("number");
  });

  it("never warns on x-* prefixed extension keys at any level", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: geojson, url: "https://example.com/d.geojson" }
    x-map-party: anything
    paint:
      circle-color: "#f00"
      x-custom-paint: whatever`)
    );
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("does not warn on intentional MapLibre map-config passthrough options", () => {
    // pixelRatio is a real MapLibre MapOption not listed in MapConfigSchema.
    const result = YAMLParser.safeParseMapBlock(`type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
  pixelRatio: 2
layers: []
`);
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("does not warn on unknown keys in a valid document with none", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: geojson, url: "https://example.com/d.geojson" }
    paint:
      circle-radius: 8`)
    );
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("warnings channel — deprecated refresh fields", () => {
  it("warns when the legacy top-level refreshInterval is used", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source:
      type: geojson
      url: "https://example.com/d.geojson"
      refreshInterval: 5000`)
    );
    expect(result.success).toBe(true);
    const dep = result.warnings.find((w) =>
      w.message.includes("refreshInterval")
    );
    expect(dep).toBeDefined();
    expect(dep!.message).toContain("deprecated");
    expect(dep!.message).toContain("refresh.refreshInterval");
    expect(dep!.suggestion).toBe("refresh");
    expect(typeof dep!.line).toBe("number");
  });

  it("does not warn when refresh is nested in a refresh block", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source:
      type: geojson
      url: "https://example.com/d.geojson"
      refresh:
        refreshInterval: 5000
        updateStrategy: replace`)
    );
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("warnings channel — bounded expression checks", () => {
  it("warns on an unknown expression operator with a suggestion", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: geojson, url: "https://example.com/d.geojson" }
    filter: ["get2", "x"]`)
    );
    expect(result.success).toBe(true);
    expect(result.warnings[0].message).toBe(
      'Unknown expression operator "get2". Did you mean "get"?'
    );
    expect(result.warnings[0].suggestion).toBe("get");
  });

  it("flags an obvious arity-zero mistake on a known operator", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: geojson, url: "https://example.com/d.geojson" }
    filter: ["get"]`)
    );
    expect(result.success).toBe(true);
    expect(result.warnings[0].message).toBe(
      'Expression operator "get" expects at least one argument.'
    );
  });

  it("does not warn on valid expressions or zero-arg operators", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: geojson, url: "https://example.com/d.geojson" }
    paint:
      circle-radius:
        - interpolate
        - ["linear"]
        - ["zoom"]
        - 5
        - 2
        - 15
        - 10`)
    );
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("root-level $ref source resolution", () => {
  it("resolves a valid root-level $ref source end-to-end", () => {
    const result = YAMLParser.safeParse(`sources:
  boundaries:
    type: geojson
    url: "https://example.com/boundaries.geojson"
pages:
  - path: "/"
    title: "T"
    blocks:
      - type: map
        id: m
        config:
          center: [0, 0]
          zoom: 2
          mapStyle: "https://demotiles.maplibre.org/style.json"
        layers:
          - id: outline
            type: line
            source: { $ref: "#/sources/boundaries" }
`);
    expect(result.success).toBe(true);
    const block = (result.data as any).pages[0].blocks[0];
    const source = block.layers[0].source;
    // The $ref object was replaced with the actual source definition.
    expect(source.type).toBe("geojson");
    expect(source.url).toBe("https://example.com/boundaries.geojson");
    expect(source.$ref).toBeUndefined();
  });

  it("errors on a dangling $ref source with a did-you-mean suggestion", () => {
    const result = YAMLParser.safeParse(`sources:
  boundaries:
    type: geojson
    url: "https://example.com/boundaries.geojson"
pages:
  - path: "/"
    title: "T"
    blocks:
      - type: map
        id: m
        config:
          center: [0, 0]
          zoom: 2
          mapStyle: "https://demotiles.maplibre.org/style.json"
        layers:
          - id: outline
            type: line
            source: { $ref: "#/sources/boundarie" }
`);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain(
      "Source reference not found: #/sources/boundarie"
    );
    expect(result.errors[0].message).toContain('Did you mean "#/sources/boundaries"?');
    expect(result.errors[0].message).toContain("Defined sources: boundaries.");
  });
});

describe("warnings survive alongside hard errors", () => {
  it("still reports unknown-key warnings when validation also fails", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: geojson, url: "https://example.com/d.geojson" }
    paint:
      circle-radis: 8
  - id: q
    type: circle
    source: { type: geojson }`)
    );
    // The second layer's geojson source has no url/data → hard error.
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(
      result.warnings.some((w) => w.message.includes("circle-radis"))
    ).toBe(true);
  });
});
