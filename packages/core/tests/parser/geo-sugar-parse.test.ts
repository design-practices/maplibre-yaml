import { describe, it, expect } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";

/**
 * U2 — the geo-sugar pre-validation seam.
 *
 * @remarks
 * Sugar (`location`/`locations`/`region`/`route`) is expanded on the raw parsed
 * block *after* version detection and *before* schema validation, so the
 * expanded `Feature` is what the schema validates (a v2 RFC-7946 hard error, a
 * v1 lenient pass) and schema errors on the expanded geometry re-anchor to the
 * authored sugar key (KTD1a). The seam covers the standalone v1/v2 map-block
 * path and the multi-page `RootSchema`/`pages:` path.
 */

const V2_LOCATION = `
version: 2
type: map
id: sugar-v2
style:
  basemap: "https://demotiles.maplibre.org/style.json"
  sources:
    pts:
      type: geojson
      location:
        coordinates: [-73.9857, 40.7484]
        name: Empire State
  layers:
    - id: pts-layer
      type: circle
      source: pts
`;

const V2_BAD_REGION = `
version: 2
type: map
id: sugar-v2-bad
style:
  basemap: "https://demotiles.maplibre.org/style.json"
  sources:
    poly:
      type: geojson
      region:
        coordinates: [[[0]]]
  layers:
    - id: poly-layer
      type: fill
      source: poly
`;

const V1_BAD_REGION = `
type: map
id: sugar-v1-lenient
config:
  center: [0, 0]
  zoom: 5
  mapStyle: "https://demotiles.maplibre.org/style.json"
sources:
  poly:
    type: geojson
    region:
      coordinates: [[[0]]]
layers:
  - id: poly-layer
    type: fill
    source: poly
`;

const ROOT_LOCATION = `
pages:
  - path: "/"
    title: Home
    blocks:
      - type: map
        id: page-map
        config:
          center: [0, 0]
          zoom: 5
          mapStyle: "https://demotiles.maplibre.org/style.json"
        sources:
          pts:
            type: geojson
            location:
              coordinates: [-73.9857, 40.7484]
        layers:
          - id: pts-layer
            type: circle
            source: pts
`;

const V1_SUGAR_ON_VECTOR = `
type: map
id: sugar-vector
config:
  center: [0, 0]
  zoom: 5
  mapStyle: "https://demotiles.maplibre.org/style.json"
sources:
  bad:
    type: vector
    location:
      coordinates: [0, 0]
layers: []
`;

const V1_SUGAR_TYPELESS = `
type: map
id: sugar-typeless
config:
  center: [0, 0]
  zoom: 5
  mapStyle: "https://demotiles.maplibre.org/style.json"
sources:
  bad:
    location:
      coordinates: [0, 0]
layers: []
`;

const V1_SUGAR_PLUS_URL = `
type: map
id: sugar-plus-url
config:
  center: [0, 0]
  zoom: 5
  mapStyle: "https://demotiles.maplibre.org/style.json"
sources:
  s:
    type: geojson
    location:
      coordinates: [0, 0]
    url: "https://example.com/points.geojson"
layers: []
`;

const V1_TWO_SUGAR_KEYS = `
type: map
id: sugar-two-keys
config:
  center: [0, 0]
  zoom: 5
  mapStyle: "https://demotiles.maplibre.org/style.json"
sources:
  s:
    type: geojson
    location:
      coordinates: [0, 0]
    route:
      coordinates: [[0, 0], [1, 1]]
layers: []
`;

const V1_INLINE_ROUTE = `
type: map
id: inline-route
config:
  center: [0, 0]
  zoom: 5
  mapStyle: "https://demotiles.maplibre.org/style.json"
layers:
  - id: route-layer
    type: line
    source:
      type: geojson
      route:
        coordinates: [[0, 0], [1, 1], [2, 2]]
`;

describe("geo-sugar parse seam (U2)", () => {
  it("v2 source with `location:` expands to a Feature<Point> `data`, dropping the sugar key", () => {
    const result = YAMLParser.safeParseMapBlock(V2_LOCATION);
    expect(result.success).toBe(true);
    const source = (result.data as any).style.sources.pts;
    expect(source.location).toBeUndefined();
    expect(source.data).toBeDefined();
    expect(source.data.type).toBe("Feature");
    expect(source.data.geometry.type).toBe("Point");
    expect(source.data.geometry.coordinates).toEqual([-73.9857, 40.7484]);
    expect(source.data.properties.name).toBe("Empire State");
  });

  it("v2 malformed EXPANDED geometry fails with an RFC-7946 error re-anchored at the `region:` key (KTD1a)", () => {
    const result = YAMLParser.safeParseMapBlock(V2_BAD_REGION);
    expect(result.success).toBe(false);
    // The error must exist and point at the authored sugar key, not the
    // synthesized `data` node the author never wrote.
    const anchored = result.errors.find((e) => /region/.test(e.path));
    expect(anchored).toBeDefined();
    expect(anchored!.path).toBe("style.sources.poly.region");
    expect(anchored!.path).not.toMatch(/\.data\b/);
    // Re-anchoring makes the position resolvable against the original AST.
    expect(typeof anchored!.line).toBe("number");
    // No error should leak a `data.*` path.
    expect(result.errors.every((e) => !/\.data\./.test(e.path))).toBe(true);
  });

  it("v1 source with the same coordinate-value malformation parses (lenient z.any())", () => {
    const result = YAMLParser.safeParseMapBlock(V1_BAD_REGION);
    expect(result.success).toBe(true);
    const source = (result.data as any).sources.poly;
    expect(source.region).toBeUndefined();
    expect(source.data.type).toBe("Feature");
    expect(source.data.geometry.type).toBe("Polygon");
    expect(source.data.geometry.coordinates).toEqual([[[0]]]);
  });

  it("multi-page `pages:` document expands a v1 `location:` sugar source (OQ1/R1)", () => {
    const result = YAMLParser.safeParse(ROOT_LOCATION);
    expect(result.success).toBe(true);
    const source = (result.data as any).pages[0].blocks[0].sources.pts;
    expect(source.location).toBeUndefined();
    expect(source.data.type).toBe("Feature");
    expect(source.data.geometry.type).toBe("Point");
    // Not the "GeoJSON source requires url/data/prefetchedData" failure.
    expect(
      result.errors.some((e) => /requires .*url|data/i.test(e.message))
    ).toBe(false);
  });

  it("a sugar key on a `type: vector` source is a sugar-specific error, not a source-union failure (R5)", () => {
    const result = YAMLParser.safeParseMapBlock(V1_SUGAR_ON_VECTOR);
    expect(result.success).toBe(false);
    const err = result.errors.find((e) => /sources\.bad/.test(e.path));
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/geojson/i);
    expect(err!.message).not.toMatch(/Unknown source type/i);
  });

  it("a sugar key on a type-less source is a sugar-specific error (R5)", () => {
    const result = YAMLParser.safeParseMapBlock(V1_SUGAR_TYPELESS);
    expect(result.success).toBe(false);
    const err = result.errors.find((e) => /sources\.bad/.test(e.path));
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/geojson/i);
  });

  it("mutual exclusion: `location:` + `url:` on one source is an error naming the source path (R5)", () => {
    const result = YAMLParser.safeParseMapBlock(V1_SUGAR_PLUS_URL);
    expect(result.success).toBe(false);
    const err = result.errors.find((e) => /sources\.s\b/.test(e.path));
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/url|data/i);
  });

  it("two sugar keys on one source is an error (R5)", () => {
    const result = YAMLParser.safeParseMapBlock(V1_TWO_SUGAR_KEYS);
    expect(result.success).toBe(false);
    const err = result.errors.find((e) => /sources\.s\b/.test(e.path));
    expect(err).toBeDefined();
    expect(err!.message).toMatch(/one sugar key|at most one/i);
  });

  it("an inline layer source carrying `route:` expands like a named source", () => {
    const result = YAMLParser.safeParseMapBlock(V1_INLINE_ROUTE);
    expect(result.success).toBe(true);
    const source = (result.data as any).layers[0].source;
    expect(source.route).toBeUndefined();
    expect(source.data.type).toBe("Feature");
    expect(source.data.geometry.type).toBe("LineString");
    expect(source.data.geometry.coordinates).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });
});
