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
      'Unknown source type "geojsn". Valid types: geojson, vector, raster, raster-dem, image, video. Did you mean "geojson"?'
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
      'Unknown source type "geojsn". Valid types: geojson, vector, raster, raster-dem, image, video. Did you mean "geojson"?'
    );
  });

  it('unknown source type "raster-dme" suggests raster-dem', () => {
    const result = YAMLParser.safeParse(`sources:
  terrain:
    type: raster-dme
    url: "https://example.com/terrain.json"
pages:
  - path: "/"
    title: "T"
    blocks: []
`);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain('Did you mean "raster-dem"?');
  });

  it("mines the real failure for a malformed raster-dem source", () => {
    // Guards the two registration points a new source type must hit: drop
    // raster-dem from SOURCE_TYPES and this reports "Unknown source type";
    // drop it from LayerSourceSchema and union mining falls back to the
    // generic "does not match any of the expected formats".
    const result = YAMLParser.safeParse(`sources:
  terrain:
    type: raster-dem
    encoding: srtm
    url: "https://example.com/terrain.json"
pages:
  - path: "/"
    title: "T"
    blocks: []
`);
    expect(result.success).toBe(false);
    const err = result.errors.find((e) => e.path === "sources.terrain");
    expect(err).toBeDefined();
    // The real per-field failure, not a generic "matched no union member".
    expect(err!.message).toBe(
      "Invalid enum value. Expected 'terrarium' | 'mapbox' | 'custom', received 'srtm'"
    );
    expect(err!.line).toBe(3);
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

describe("block dispatch — empty/null top-level type", () => {
  it("routes a present-but-null `type:` with `pages:` to the root document", () => {
    const { blockType, result } = YAMLParser.safeParseAny(`type:
pages: []
`);
    // Falls through to pages-based root detection, not "Unknown block type".
    expect(blockType).toBe("root");
    expect(
      result.errors.every((e) => !e.message.includes("Unknown block type"))
    ).toBe(true);
  });

  it("validates a null-type root document with real pages", () => {
    const { blockType, result } = YAMLParser.safeParseAny(`type:
pages:
  - path: "/"
    title: "Home"
    blocks: []
`);
    expect(blockType).toBe("root");
    expect(result.success).toBe(true);
  });
});

describe("valid source type failing for another reason (not 'unknown type')", () => {
  // A source with a VALID type that fails for a different reason must surface
  // the real failure — never a self-contradictory "Unknown source type
  // <valid-type>. Valid types: ..., <valid-type>, ...".
  it("reports the real url/data error for a block-level geojson source missing url/data", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: geojson }`)
    );
    expect(result.success).toBe(false);
    const err = result.errors.find((e) => e.path.includes("source"));
    expect(err).toBeDefined();
    expect(err!.message).toContain("url");
    expect(err!.message).toContain("data");
    expect(err!.message).not.toContain("Unknown source type");
  });

  it("reports the real url/data error for a root-level geojson source missing url/data", () => {
    const result = YAMLParser.safeParse(`sources:
  s:
    type: geojson
pages:
  - path: "/"
    title: "T"
    blocks: []
`);
    expect(result.success).toBe(false);
    expect(result.errors[0].path).toBe("sources.s");
    expect(result.errors[0].message).toContain("url");
    expect(result.errors[0].message).toContain("data");
    expect(result.errors[0].message).not.toContain("Unknown source type");
  });

  it("does not mislabel an image source (valid type) missing coordinates as unknown", () => {
    // image/video sources abort the parse on required fields, so no union
    // branch is 'dirty' and the sibling `invalid_literal` type mismatches would
    // otherwise be mined into 'Unknown source type "image"'.
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: image }`)
    );
    expect(result.success).toBe(false);
    expect(
      result.errors.every((e) => !e.message.includes("Unknown source type"))
    ).toBe(true);
  });

  it("still reports a genuinely unknown source type", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: geojsn, url: "https://example.com/d.geojson" }`)
    );
    expect(result.success).toBe(false);
    const err = result.errors.find((e) => e.message.includes("source type"));
    expect(err!.message).toBe(
      'Unknown source type "geojsn". Valid types: geojson, vector, raster, raster-dem, image, video. Did you mean "geojson"?'
    );
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

  it("does not warn on intentional MapLibre source passthrough options", () => {
    // Sources are `.passthrough()` — valid-but-unlisted MapLibre options like
    // maxzoom/cluster/buffer must not be flagged as unknown keys.
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source:
      type: geojson
      url: "https://example.com/d.geojson"
      maxzoom: 12
      buffer: 64
      tolerance: 0.5`)
    );
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("does not warn on raster-dem custom-encoding factors", () => {
    // Pins markOpenSchema(RasterDEMSourceSchema): without that registration
    // the documented custom-encoding factors would be flagged as unknown keys.
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: hills
    type: hillshade
    source:
      type: raster-dem
      url: "https://example.com/terrain.json"
      encoding: custom
      redFactor: 256
      greenFactor: 1
      blueFactor: 0.00390625
      baseShift: 32768`)
    );
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("still warns on paint-object typos even though sources are open", () => {
    // Sources being open must NOT relax paint/layout typo detection.
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: geojson, url: "https://example.com/d.geojson", maxzoom: 12 }
    paint:
      circle-radis: 8`)
    );
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toBe(
      'Unknown key "circle-radis". Did you mean "circle-radius"?'
    );
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

describe("warnings channel — deprecated interaction actions", () => {
  const triggers = ["click", "mouseenter", "mouseleave"] as const;

  it.each(triggers)("warns on %s.action with position and a v2 notice", (trigger) => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: geojson, url: "https://example.com/d.geojson" }
    interactive:
      ${trigger}:
        action: doSomething`)
    );

    // Deprecated, not invalid — the config still parses.
    expect(result.success).toBe(true);

    const dep = result.warnings.find((w) => w.path.endsWith(`${trigger}.action`));
    expect(dep).toBeDefined();
    expect(dep!.kind).toBe("deprecation");
    expect(dep!.message).toContain("deprecated");
    expect(dep!.message).toContain("v2");
    expect(typeof dep!.line).toBe("number");
    expect(typeof dep!.column).toBe("number");
  });

  it("does not warn on an interaction config without action", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: geojson, url: "https://example.com/d.geojson" }
    interactive:
      click:
        popup: [{ p: [{ str: "Hi" }] }]`)
    );
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("marks legacy refresh warnings as deprecations too", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source:
      type: geojson
      url: "https://example.com/d.geojson"
      refreshInterval: 5000`)
    );
    const dep = result.warnings.find((w) => w.message.includes("refreshInterval"));
    expect(dep!.kind).toBe("deprecation");
  });

  it("does not flag scrollytelling chapter actions, which share the field name", () => {
    // `action` also exists on chapter actions, where it is current API. The
    // rule is scoped to interactive.{click,mouseenter,mouseleave}.action, and
    // this pins that scoping against the name collision.
    const result = YAMLParser.safeParseAny(`type: scrollytelling
id: s
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
chapters:
  - id: c1
    title: "One"
    actions:
      - action: setFilter
        layer: p
        filter: ["==", "kind", "a"]
`);
    const falsePositive = result.result.warnings.find(
      (w) => w.kind === "deprecation"
    );
    expect(falsePositive).toBeUndefined();
  });

  it("does not mark unknown-key warnings as deprecations", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapBlock(`  - id: p
    type: circle
    source: { type: geojson, url: "https://example.com/d.geojson" }
    paint: { circle-radis: 4 }`)
    );
    const unknown = result.warnings.find((w) => w.message.includes("circle-radis"));
    expect(unknown).toBeDefined();
    expect(unknown!.kind).toBeUndefined();
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

  it("does not flag legacy MapLibre filter operators as unknown", () => {
    for (const filter of [
      '["!in", "type", "a", "b"]',
      '["!has", "x"]',
      '["none", ["==", "t", "a"]]',
    ]) {
      const result = YAMLParser.safeParseMapBlock(
        mapBlock(`  - id: p
    type: circle
    source: { type: geojson, url: "https://example.com/d.geojson" }
    filter: ${filter}`)
      );
      expect(result.success).toBe(true);
      expect(
        result.warnings.some((w) => w.message.includes("Unknown expression operator"))
      ).toBe(false);
    }
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
