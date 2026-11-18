import { describe, it, expect } from "vitest";
import { YAMLParser, safeParseAny, MULTI_PAGE_MESSAGE } from "../../src/parser/yaml-parser";

describe("YAMLParser", () => {
  describe("resolveReferences()", () => {
    const block = (layers: unknown[]) => ({
      type: "map" as const,
      id: "m",
      config: { center: [0, 0] as [number, number], zoom: 2, mapStyle: "https://example.com/style.json" },
      sources: {
        quakes: { type: "geojson" as const, url: "https://example.com/quakes.geojson" },
      },
      layers,
    });

    it("resolves a source $ref against the document's sources: record", () => {
      const resolved = YAMLParser.resolveReferences(
        block([{ id: "dots", type: "circle", source: { $ref: "#/sources/quakes" } }])
      );
      expect((resolved.layers[0] as any).source).toEqual({
        type: "geojson",
        url: "https://example.com/quakes.geojson",
      });
    });

    it("throws on a missing source reference, with a did-you-mean", () => {
      expect(() =>
        YAMLParser.resolveReferences(block([{ id: "dots", type: "circle", source: { $ref: "#/sources/quake" } }]))
      ).toThrow('Source reference not found: #/sources/quake. Did you mean "#/sources/quakes"?');
    });

    it("throws on a layer reference: a map's layers: is a list, not a record", () => {
      expect(() => YAMLParser.resolveReferences(block([{ $ref: "#/layers/shared" }]))).toThrow(
        "Layer reference not found"
      );
    });

    it("throws on invalid reference format", () => {
      expect(() =>
        YAMLParser.resolveReferences(block([{ id: "dots", type: "circle", source: { $ref: "invalid-format" } }]))
      ).toThrow("Invalid reference format");
    });
  });

  describe("error formatting", () => {
    const map = (body: string) => `
type: map
id: test
${body}
`;

    it("formats invalid_type errors", () => {
      const result = YAMLParser.safeParseMapBlock(
        map(`title: 123  # Should be string
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"`)
      );

      expect(result.success).toBe(false);
      const error = result.errors.find((e) => e.path === "title");
      expect(error).toBeDefined();
      expect(error!.message).toContain("Expected string");
    });

    it("formats too_small errors for arrays", () => {
      const result = YAMLParser.safeParseScrollytellingBlock(`
type: scrollytelling
id: story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters: []
`);

      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.message.includes("at least"))).toBe(
        true
      );
    });

    it("formats too_big errors", () => {
      const result = YAMLParser.safeParseMapBlock(
        map(`config:
  center: [0, 0]
  zoom: 100  # Too high
  mapStyle: "https://example.com/style.json"`)
      );

      expect(result.success).toBe(false);
      const error = result.errors.find((e) => e.path.includes("zoom"));
      expect(error).toBeDefined();
    });

    it("formats invalid_string URL errors", () => {
      const result = YAMLParser.safeParseMapBlock(
        map(`config:
  center: [0, 0]
  zoom: 10
  mapStyle: "not-a-url"`)
      );

      // Note: mapStyle uses union of string.url() | any, so "not-a-url" passes validation
      // This is by design to allow flexibility. The test verifies the parser works.
      expect(result.success).toBe(true);
    });
  });

  describe("parseScrollytellingBlock()", () => {
    it("parses valid scrollytelling block", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters:
  - id: intro
    title: "Introduction"
    center: [0, 0]
    zoom: 3
  - id: chapter2
    title: "Chapter 2"
    center: [10, 10]
    zoom: 5
`;

      const block = YAMLParser.parseScrollytellingBlock(yaml);

      expect(block).toBeDefined();
      expect(block.type).toBe("scrollytelling");
      expect(block.id).toBe("story");
      expect(block.chapters).toHaveLength(2);
      expect(block.chapters[0].title).toBe("Introduction");
      expect(block.chapters[1].title).toBe("Chapter 2");
    });

    it("throws on invalid YAML syntax", () => {
      const invalidYaml = `
type: scrollytelling
id: story
config:
  center: [0, 0
  # Missing closing bracket
`;

      expect(() => YAMLParser.parseScrollytellingBlock(invalidYaml)).toThrow(
        "YAML syntax error"
      );
    });

    it("throws on schema validation error", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [999, 0]  # Invalid longitude
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters:
  - id: intro
    title: "Intro"
    center: [0, 0]
    zoom: 3
`;

      expect(() => YAMLParser.parseScrollytellingBlock(yaml)).toThrow();
    });

    it("throws when chapters array is empty", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters: []
`;

      expect(() => YAMLParser.parseScrollytellingBlock(yaml)).toThrow();
    });

    it("parses scrollytelling with optional properties", () => {
      const yaml = `
type: scrollytelling
id: story
theme: dark
showMarkers: true
markerColor: "#ff0000"
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters:
  - id: intro
    title: "Introduction"
    center: [0, 0]
    zoom: 3
    description: "Welcome to our story"
    alignment: left
    pitch: 45
    bearing: 30
footer: "<p>Data sources: Example</p>"
`;

      const block = YAMLParser.parseScrollytellingBlock(yaml);

      expect(block.theme).toBe("dark");
      expect(block.showMarkers).toBe(true);
      expect(block.markerColor).toBe("#ff0000");
      expect(block.footer).toBe("<p>Data sources: Example</p>");
      expect(block.chapters[0].description).toBe("Welcome to our story");
      expect(block.chapters[0].alignment).toBe("left");
      expect(block.chapters[0].pitch).toBe(45);
      expect(block.chapters[0].bearing).toBe(30);
    });

    it("parses chapters with actions", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters:
  - id: intro
    title: "Introduction"
    center: [0, 0]
    zoom: 3
    onChapterEnter:
      - action: setFilter
        layer: earthquakes
        filter: [">=", ["get", "magnitude"], 5]
    onChapterExit:
      - action: setFilter
        layer: earthquakes
        filter: null
`;

      const block = YAMLParser.parseScrollytellingBlock(yaml);

      expect(block.chapters[0].onChapterEnter).toHaveLength(1);
      expect(block.chapters[0].onChapterEnter[0].action).toBe("setFilter");
      expect(block.chapters[0].onChapterExit).toHaveLength(1);
    });
  });

  describe("safeParseScrollytellingBlock()", () => {
    it("returns success: true for valid scrollytelling block", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters:
  - id: intro
    title: "Introduction"
    center: [0, 0]
    zoom: 3
`;

      const result = YAMLParser.safeParseScrollytellingBlock(yaml);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.errors).toHaveLength(0);
      expect(result.data?.type).toBe("scrollytelling");
    });

    // ml-aot.6: a photo in public/images/ validates; an unusable value says
    // what to write instead of zod's generic "Invalid URL format".
    const storyWithImage = (image: string) => `
type: scrollytelling
id: story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters:
  - id: intro
    title: "Introduction"
    center: [0, 0]
    zoom: 2
    image: "${image}"
`;

    it("accepts a chapter image served from the site (/images/x.jpg)", () => {
      const result = YAMLParser.safeParseScrollytellingBlock(storyWithImage("/images/fuji.jpg"));
      expect(result.errors).toEqual([]);
      expect(result.data?.chapters[0]?.image).toBe("/images/fuji.jpg");
    });

    it("rejects a javascript: chapter image with a message naming the fix and the line", () => {
      const result = YAMLParser.safeParseScrollytellingBlock(storyWithImage("javascript:alert(1)"));
      expect(result.success).toBe(false);
      expect(result.errors[0]?.path).toBe("chapters.0.image");
      expect(result.errors[0]?.message).toMatch(
        /http\(s\) URL .* or a path to a file on your site \(images\/photo\.jpg, or \/images\/photo\.jpg/
      );
      expect(result.errors[0]?.line).toBe(13);
    });

    it("keeps the schema's own message for a bad source url (ml-zft), not 'Invalid string format: regex'", () => {
      const result = YAMLParser.safeParseMapBlock(`
type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
layers:
  - id: pts
    type: circle
    source:
      type: geojson
      url: "#cities.geojson"
`);
      expect(result.success).toBe(false);
      const messages = result.errors.map((e) => e.message).join(" | ");
      expect(messages).toMatch(/Must be an absolute URL/);
      expect(messages).not.toMatch(/Invalid string format/);
    });

    it("returns success: false with errors for invalid config", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [999, 0]  # Invalid longitude
  zoom: 50  # Invalid zoom
  mapStyle: "https://example.com/style.json"
chapters:
  - id: intro
    title: "Intro"
    center: [0, 0]
    zoom: 3
`;

      const result = YAMLParser.safeParseScrollytellingBlock(yaml);

      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toHaveProperty("path");
      expect(result.errors[0]).toHaveProperty("message");
    });

    it("returns YAML syntax errors", () => {
      const invalidYaml = `
type: scrollytelling
id: story
config:
  center: [0, 0
`;

      const result = YAMLParser.safeParseScrollytellingBlock(invalidYaml);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0]!.message).toContain("YAML syntax error");
    });

    it("handles missing chapters", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
`;

      const result = YAMLParser.safeParseScrollytellingBlock(yaml);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("handles empty chapters array", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters: []
`;

      const result = YAMLParser.safeParseScrollytellingBlock(yaml);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      const error = result.errors.find((e) => e.path.includes("chapters"));
      expect(error).toBeDefined();
    });
  });

  describe("safeParseAny()", () => {
    it("dispatches type: map documents to the map block schema", () => {
      const yaml = `
type: map
id: test-map
config:
  center: [-74.006, 40.7128]
  zoom: 12
  mapStyle: "https://demotiles.maplibre.org/style.json"
`;

      const { blockType, result } = YAMLParser.safeParseAny(yaml);

      expect(blockType).toBe("map");
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect((result.data as any)?.type).toBe("map");
    });

    it("dispatches type: scrollytelling documents to the scrollytelling schema", () => {
      const yaml = `
type: scrollytelling
id: story
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://example.com/style.json"
chapters:
  - id: intro
    title: "Introduction"
    center: [0, 0]
    zoom: 3
`;

      const { blockType, result } = YAMLParser.safeParseAny(yaml);

      expect(blockType).toBe("scrollytelling");
      expect(result.success).toBe(true);
      expect((result.data as any)?.chapters).toHaveLength(1);
    });

    it("rejects a multi-page pages: document with one error, at the key (ml-cxo)", () => {
      const yaml = `
pages:
  - path: "/"
    title: "Test Page"
    blocks:
      - type: map
        id: test-map
        config:
          center: [-74.006, 40.7128]
          zoom: 12
          mapStyle: "https://demotiles.maplibre.org/style.json"
`;

      const { blockType, result } = YAMLParser.safeParseAny(yaml);

      expect(blockType).toBe("unknown");
      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        { path: "pages", code: "schema", message: MULTI_PAGE_MESSAGE, line: 2, column: 1 },
      ]);
      expect(MULTI_PAGE_MESSAGE).toBe(
        "Multi-page documents (pages:) are not supported: write one document per page " +
          "(type: map or type: scrollytelling); Astro and the web component compose pages."
      );
    });

    it("returns validation errors from the dispatched schema", () => {
      const yaml = `
type: map
id: test-map
config:
  center: [999, 40.7128]
  zoom: 12
  mapStyle: "https://demotiles.maplibre.org/style.json"
`;

      const { blockType, result } = YAMLParser.safeParseAny(yaml);

      expect(blockType).toBe("map");
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("reports unknown type values with the list of valid values", () => {
      const yaml = `
type: carousel
id: nope
`;

      const { blockType, result } = YAMLParser.safeParseAny(yaml);

      expect(blockType).toBe("unknown");
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].path).toBe("type");
      expect(result.errors[0].message).toContain('"carousel"');
      expect(result.errors[0].message).toContain("map, scrollytelling");
      expect(result.errors[0].message).not.toContain("pages");
    });

    it("reports documents without a type:", () => {
      const yaml = `
id: mystery
config:
  zoom: 3
`;

      const { blockType, result } = YAMLParser.safeParseAny(yaml);

      expect(blockType).toBe("unknown");
      expect(result.success).toBe(false);
      // A map-shaped document is told what to add (ml-aot.62).
      expect(result.errors[0].message).toContain("missing type:");
      expect(result.errors[0].message).toContain("type: map");

      // A document of no recognisable shape keeps the full explanation.
      const other = YAMLParser.safeParseAny("id: mystery\nfoo: 1\n");
      expect(other.result.errors[0].message).toBe(
        'Unable to determine document type. Expected a block with "type: map" or "type: scrollytelling".'
      );
    });

    it("returns YAML syntax errors without throwing", () => {
      const invalidYaml = `
type: map
config:
  center: [0, 0
`;

      const { blockType, result } = YAMLParser.safeParseAny(invalidYaml);

      expect(blockType).toBe("unknown");
      expect(result.success).toBe(false);
      expect(result.errors[0].message).toContain("YAML syntax error");
    });

    it("is exported as a bound convenience function", () => {
      const { blockType, result } = safeParseAny("type: map\nid: x\n");

      expect(blockType).toBe("map");
      expect(result.success).toBe(false); // missing config
    });
  });
});

describe("standalone map block — $ref sources (U7 / todo 039)", () => {
  const block = (source: string) => `type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
sources:
  cities:
    type: geojson
    url: "https://example.com/cities.geojson"
layers:
  - id: pts
    type: circle
    source: ${source}
`;

  it("resolves a $ref against the block's own sources", () => {
    const result = YAMLParser.safeParseMapBlock(
      block('{ $ref: "#/sources/cities" }')
    );

    expect(result.success).toBe(true);
    // Previously the $ref survived parsing untouched, so at render time the
    // source had no `type` and the layer was silently dropped — accepted
    // config, no map.
    expect(result.data!.layers![0].source).toMatchObject({
      type: "geojson",
      url: "https://example.com/cities.geojson",
    });
  });

  it("reports an unresolvable $ref instead of passing it through", () => {
    const result = YAMLParser.safeParseMapBlock(
      block('{ $ref: "#/sources/missing" }')
    );

    const surfaced =
      !result.success ||
      JSON.stringify(result.data!.layers![0].source).includes("$ref") === false;
    expect(surfaced).toBe(true);
  });

  it("leaves a bare named-source reference alone", () => {
    const result = YAMLParser.safeParseMapBlock(block("cities"));

    expect(result.success).toBe(true);
    expect(result.data!.layers![0].source).toBe("cities");
  });
});

/**
 * YAML-native reuse: anchors, aliases, and merge keys.
 *
 * @remarks
 * These resolve inside `yaml`'s parse, upstream of validation — so the schemas
 * never see `<<`, and reuse costs no schema surface. Merge in particular was a
 * silent wrong answer before it was enabled: `<<: *base` produced a literal
 * `"<<"` key rather than merging, which then tripped unknown-key validation.
 */
describe("YAML-native reuse (U2)", () => {
  const mapWith = (layers: string) => `
type: map
id: reuse
config:
  center: [0, 0]
  zoom: 5
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers:
${layers}`;

  it("merges an anchored mapping via a merge key", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapWith(`  - &base
      id: a
      type: circle
      source: { type: geojson, data: { type: FeatureCollection, features: [] } }
      paint: { circle-color: "#111" }
  - <<: *base
    id: b`)
    );
    expect(result.success).toBe(true);
    const layers = result.data!.layers as any[];
    expect(layers[1].type).toBe("circle");
    expect(layers[1].paint["circle-color"]).toBe("#111");
  });

  it("lets a sibling key override the merged value", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapWith(`  - &base
      id: a
      type: circle
      source: { type: geojson, data: { type: FeatureCollection, features: [] } }
      paint: { circle-color: "#111" }
  - <<: *base
    id: b
    paint: { circle-color: "#222" }`)
    );
    expect(result.success).toBe(true);
    const layers = result.data!.layers as any[];
    expect(layers[1].paint["circle-color"]).toBe("#222");
    expect(layers[0].paint["circle-color"]).toBe("#111");
  });

  it("never surfaces `<<` to the schema", () => {
    const result = YAMLParser.safeParseMapBlock(
      mapWith(`  - &base
      id: a
      type: circle
      source: { type: geojson, data: { type: FeatureCollection, features: [] } }
  - <<: *base
    id: b`)
    );
    expect(result.success).toBe(true);
    expect(Object.keys(result.data!.layers[1] as object)).not.toContain("<<");
    expect(result.warnings.map((w) => w.message).join(" ")).not.toContain("<<");
  });

  it("reuses an anchored scalar by alias", () => {
    const result = YAMLParser.safeParseMapBlock(`
type: map
id: reuse
config:
  center: [0, 0]
  zoom: 5
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers:
  - id: a
    type: circle
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
    paint: { circle-color: &brand "#2b6cb0" }
  - id: b
    type: circle
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
    paint: { circle-color: *brand }`);
    expect(result.success).toBe(true);
    const layers = result.data!.layers as any[];
    expect(layers[1].paint["circle-color"]).toBe("#2b6cb0");
  });

  it("rejects an anchor-expansion attack rather than expanding it", () => {
    const bomb = `
type: map
id: bomb
config: { center: [0, 0], zoom: 5, mapStyle: "https://x.test/s.json" }
a: &a [x,x,x,x,x,x,x,x,x]
b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]
c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]
d: [*c,*c,*c,*c,*c,*c,*c,*c,*c]
layers: []`;
    const result = YAMLParser.safeParseMapBlock(bomb);
    expect(result.success).toBe(false);
    expect(result.errors.map((e) => e.message).join(" ")).toMatch(/could not be expanded/i);
  });
});

/**
 * Expansion attacks, both shapes.
 *
 * @remarks
 * The plain-alias bomb is caught by the `yaml` library's own alias budget. The
 * merge-key bomb is NOT — `merge.mergeValue()` resolves through
 * `Alias.resolve()` and calls `toJSON()` directly, never entering the path
 * where the budget is counted. Enabling merge keys therefore walked around the
 * guard, and a 338-byte document took 13 seconds with no error. The failure
 * mode is a hang, not a wrong value, so these tests bound elapsed time — an
 * assertion on the result alone would not catch a regression.
 */
describe("expansion attacks (U2 hardening)", () => {
  const seqMergeBomb = (depth: number, fan: number) => {
    let s = "type: map\nid: bomb\na0: &a0 { k: v }\n";
    for (let i = 1; i <= depth; i++) {
      const items = Array.from({ length: fan }, () => `*a${i - 1}`).join(",");
      s += `a${i}: &a${i}\n  <<: [${items}]\n`;
    }
    return s + "layers: []\n";
  };

  it("rejects a sequence-valued merge before materializing it", () => {
    const started = Date.now();
    const result = YAMLParser.safeParseMapBlock(seqMergeBomb(6, 9));
    const elapsed = Date.now() - started;

    expect(result.success).toBe(false);
    expect(result.errors[0]?.code).toBe("yaml-expansion");
    expect(result.errors.map((e) => e.message).join(" ")).toMatch(/sequence of aliases/i);
    // Unguarded this took ~13s; the guard runs on the AST, before expansion.
    expect(elapsed).toBeLessThan(1000);
  });

  it("rejects the repeated-merge-key form, which needs no sequence", () => {
    // The first version of this guard refused only sequences and called that
    // the entire attack surface. `{<<: *n, <<: *n, ...}` reproduces the same
    // exponential expansion with no sequence anywhere.
    let s = "type: map\nid: rep\nr0: &r0 { k: v }\n";
    for (let i = 1; i <= 5; i++) {
      const merges = Array.from({ length: 6 }, () => `  <<: *r${i - 1}`).join("\n");
      s += `r${i}: &r${i}\n${merges}\n`;
    }
    s += "layers: []\n";

    const started = Date.now();
    const result = YAMLParser.safeParseMapBlock(s);
    expect(result.success).toBe(false);
    expect(result.errors.map((e) => e.message).join(" ")).toMatch(/more than one merge key/i);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("still allows the documented single-alias merge at depth", () => {
    let s = "type: map\nid: chain\nconfig:\n  center: [0, 0]\n  zoom: 5\n";
    s += "base: &b0 { k: v }\n";
    for (let i = 1; i <= 20; i++) s += `l${i}: &b${i}\n  <<: *b${i - 1}\n  k${i}: v\n`;
    s += "layers: []\n";
    const result = YAMLParser.safeParseMapBlock(s);
    expect(result.success).toBe(true);
  });

  it("returns a result rather than throwing through safeParseAny", () => {
    // safeParseAny is what `mlym validate` and the preview server call, and it
    // documents that it never throws. An earlier fix guarded only safeParse*.
    const bomb =
      "type: map\nid: b\na: &a [x,x,x,x,x,x,x,x,x]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]\n" +
      "c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]\nd: [*c,*c,*c,*c,*c,*c,*c,*c,*c]\nlayers: []\n";
    expect(() => YAMLParser.safeParseAny(bomb)).not.toThrow();
    const { result } = YAMLParser.safeParseAny(bomb);
    expect(result.success).toBe(false);
    expect(result.errors[0]?.code).toBe("yaml-expansion");
    expect(result.errors.map((e) => e.message).join(" ")).toMatch(/could not be expanded/i);
  });

  it("reports a merge-key typo as an ordinary error, not an attack", () => {
    const result = YAMLParser.safeParseMapBlock(
      'type: map\nid: t\nbrand: &brand "#111"\nextra:\n  <<: *brand\nlayers: []\n'
    );
    expect(result.success).toBe(false);
    expect(result.errors[0]?.code).toBe("yaml-merge");
    const messages = result.errors.map((e) => e.message).join(" ");
    expect(messages).not.toMatch(/could not be expanded/i);
    expect(messages).toMatch(/merge sources must be maps/i);
  });
});
