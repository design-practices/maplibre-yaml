/**
 * `bounds` in both of MapLibre's forms (ml-aot.76): `[west, south, east,
 * north]` and `[[west, south], [east, north]]` — v1 `config.bounds` /
 * `maxBounds`, v2 `runtime.map.bounds`, a chapter's `fitBounds`. A value in
 * neither form says which order; one that reads right swapped gets the
 * swapped value to copy.
 */
import { describe, it, expect, vi } from "vitest";
import { YAMLParser } from "../../src/parser/yaml-parser";
import { boundsProblem, toFlatBounds } from "../../src/utils/bounds";
import { runChapterAction } from "../../src/scrollytelling/engine";

const STYLE = '"https://demotiles.maplibre.org/style.json"';
const v1 = (bounds: string, key = "bounds") => `type: map
id: m
config:
  center: [-73.97, 40.72]
  zoom: 2
  ${key}: ${bounds}
  mapStyle: ${STYLE}
layers: []
`;
const ORDER = "[west, south, east, north] (four numbers, longitude first) or two corners [[west, south], [east, north]]";

describe("bounds: both forms (ml-aot.76)", () => {
  it("accepts the four-number and the two-corner form, in config.bounds and maxBounds", () => {
    for (const key of ["bounds", "maxBounds"]) {
      for (const value of ["[-74.02, 40.645, -73.92, 40.80]", "[[-74.02, 40.645], [-73.92, 40.80]]"]) {
        const result = YAMLParser.safeParseMapBlock(v1(value, key));
        expect(result.errors, `${key}: ${value}`).toEqual([]);
        expect(result.success).toBe(true);
      }
    }
  });

  it("keeps bounds that cross the antimeridian (longitudes past 180)", () => {
    expect(YAMLParser.safeParseMapBlock(v1("[100, -50, 290, 62]")).success).toBe(true);
  });

  it("v2 runtime.map.bounds takes both forms, and explains a bad one", () => {
    const doc = (bounds: string) => `version: 2
type: map
id: m
style:
  center: [0, 0]
  zoom: 2
  basemap: ${STYLE}
  sources: {}
  layers: []
runtime:
  map:
    bounds: ${bounds}
`;
    expect(YAMLParser.safeParseMapBlock(doc("[[-74.02, 40.645], [-73.92, 40.80]]")).success).toBe(true);
    expect(YAMLParser.safeParseMapBlock(doc("[-74.02, 40.645, -73.92, 40.80]")).success).toBe(true);
    const bad = YAMLParser.safeParseMapBlock(doc("[[34.0, -118.5], [34.1, -118.2]]"));
    expect(bad.errors.map((e) => [e.path, e.message])).toEqual([
      [
        "runtime.map.bounds",
        expect.stringContaining("Did you mean [[-118.5, 34], [-118.2, 34.1]]?"),
      ],
    ]);
  });

  it("a value in neither form names the order, once, at the bounds line", () => {
    const cases: Array<[string, string]> = [
      ["[1, 2, 3]", `bounds has 3 numbers; it needs 4. bounds is written ${ORDER}.`],
      ["[[1, 2], [3]]", `bounds is written ${ORDER}.`],
      ['"-74.02, 40.645, -73.92, 40.80"', "bounds needs square brackets: bounds: [-74.02, 40.645, -73.92, 40.80]."],
    ];
    for (const [value, message] of cases) {
      const result = YAMLParser.safeParseMapBlock(v1(value));
      expect(result.success, value).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ path: "config.bounds", line: 6 });
      expect(result.errors[0]!.message).toContain(message);
    }
  });

  it("latitude and longitude swapped, out of range: the error gives the swapped value", () => {
    const flat = YAMLParser.safeParseMapBlock(v1("[34.0, -118.5, 34.1, -118.2]"));
    expect(flat.errors).toHaveLength(1);
    expect(flat.errors[0]!.message).toBe(
      `bounds [34, -118.5, 34.1, -118.2] has a latitude outside -90 to 90: it looks written ` +
        `[latitude, longitude]. bounds is written ${ORDER}. Did you mean [-118.5, 34, -118.2, 34.1]?`
    );
    const corners = YAMLParser.safeParseMapBlock(v1("[[34.0, -118.5], [34.1, -118.2]]"));
    expect(corners.errors[0]!.message).toContain("Did you mean [[-118.5, 34], [-118.2, 34.1]]?");
  });

  it("latitude and longitude swapped, in range: an on-page did-you-mean from the map's own places", () => {
    for (const [value, meant] of [
      ["[40.645, -74.02, 40.80, -73.92]", "[-74.02, 40.645, -73.92, 40.8]"],
      ["[[40.645, -74.02], [40.80, -73.92]]", "[[-74.02, 40.645], [-73.92, 40.8]]"],
    ]) {
      const result = YAMLParser.safeParseMapBlock(v1(value!));
      expect(result.success).toBe(true);
      const warning = result.warnings.find((w) => w.path === "config.bounds");
      expect(warning, value).toMatchObject({ onPage: true, line: 6 });
      expect(warning!.message).toContain(`did you mean ${meant}?`);
    }
    // Correct bounds near the center: no warning.
    expect(
      YAMLParser.safeParseMapBlock(v1("[-74.02, 40.645, -73.92, 40.80]")).warnings.find(
        (w) => w.path === "config.bounds"
      )
    ).toBeUndefined();
  });

  it("toFlatBounds reads either form; boundsProblem passes good values", () => {
    expect(toFlatBounds([[1, 2], [3, 4]])).toEqual([1, 2, 3, 4]);
    expect(toFlatBounds([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(toFlatBounds([1, 2, 3])).toBeNull();
    expect(boundsProblem([[1, 2], [3, 4]])).toBeUndefined();
  });

  it("a chapter's fitBounds takes the corner form", () => {
    const calls: unknown[][] = [];
    const map = {
      fitBounds: (...args: unknown[]) => calls.push(args),
      jumpTo: vi.fn(),
    };
    runChapterAction(
      map as never,
      { action: "fitBounds", bounds: [[-74.02, 40.645], [-73.92, 40.8]] } as never,
      { chapterId: "c" } as never
    );
    expect(calls[0]![0]).toEqual([
      [-74.02, 40.645],
      [-73.92, 40.8],
    ]);
  });
});
