/**
 * @file Collection entries accept the GeoJSON shorthand (ml-svf)
 *
 * @description
 * `<Map src>` and `loadMapConfig` expand `location:` / `route:` / … on a
 * `type: geojson` source before validating; a content-collection entry
 * validated with {@link getMapSchema} used to fail the same YAML with
 * "GeoJSON source requires at least one of: url, data, or prefetchedData".
 * Each case here checks the entry's data against what core's parser makes of
 * the same YAML, so the two cannot drift.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parse } from "yaml";
import { YAMLParser } from "@maplibre-yaml/core";
import { getMapSchema, getScrollytellingSchema, extendSchema } from "../../src/utils/collections";

const MAP_YAML = `type: map
id: harbour
config:
  center: [-71.05, 42.36]
  zoom: 12
  mapStyle: https://example.com/style.json
sources:
  trail:
    type: geojson
    route:
      coordinates: [[-71.06, 42.35], [-71.05, 42.36]]
      name: Harbor walk
layers:
  - id: office
    type: circle
    source:
      type: geojson
      location:
        coordinates: [-71.05, 42.36]
        name: Office
  - id: trail-line
    type: line
    source: trail
`;

describe("getMapSchema: GeoJSON shorthand (ml-svf)", () => {
  it("accepts location: and route: and expands them as <Map src> does", () => {
    const entry = parse(MAP_YAML);
    const result = getMapSchema().safeParse(entry);
    expect(result.success).toBe(true);

    const viaParser = YAMLParser.safeParseMapBlock(MAP_YAML);
    expect(viaParser.success).toBe(true);
    const data = result.data as any;
    const parsed = viaParser.data as any;
    expect(data.layers[0].source.data).toEqual(parsed.layers[0].source.data);
    expect(data.sources.trail.data).toEqual(parsed.sources.trail.data);
    expect(data.layers[0].source.data).toMatchObject({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-71.05, 42.36] },
      properties: { name: "Office" },
    });
    expect(data.layers[0].source).not.toHaveProperty("location");

    // The entry Astro passed in is left as it was.
    expect(entry.layers[0].source.location).toBeDefined();
  });

  it("reports a malformed shorthand at its path", () => {
    const entry = parse(MAP_YAML);
    entry.layers[0].source.location = { coordinates: "nowhere" };
    const result = getMapSchema().safeParse(entry);
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.path.slice(0, 4)).toEqual(["layers", 0, "source", "location"]);
  });

  it("shorthand next to url: is refused, as the parser refuses it", () => {
    const entry = parse(MAP_YAML);
    entry.layers[0].source.url = "https://example.com/x.geojson";
    const result = getMapSchema().safeParse(entry);
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/must not also carry "url"/);
    expect(YAMLParser.safeParseMapBlockValue(entry).success).toBe(false);
  });

  it("extendSchema keeps the shorthand and the extra fields", () => {
    const schema = extendSchema(getMapSchema(), { featured: z.boolean().default(false) });
    const result = schema.parse(parse(MAP_YAML)) as any;
    expect(result.featured).toBe(false);
    expect(result.layers[0].source.data.type).toBe("Feature");
  });
});

describe("getScrollytellingSchema: GeoJSON shorthand (ml-svf)", () => {
  it("accepts a chapter story whose source uses region:", () => {
    const story = parse(`type: scrollytelling
id: s
config:
  center: [0, 0]
  zoom: 2
  mapStyle: https://example.com/style.json
layers:
  - id: park
    type: fill
    source:
      type: geojson
      region:
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]
chapters:
  - id: one
    title: One
    center: [0, 0]
    zoom: 3
`);
    const result = getScrollytellingSchema().safeParse(story);
    expect(result.success).toBe(true);
    expect((result.data as any).layers[0].source.data.geometry.type).toBe("Polygon");
  });
});
