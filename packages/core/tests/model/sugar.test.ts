/**
 * @file U1 — the pure geo-sugar expander.
 * @module @maplibre-yaml/core/tests/model/sugar
 *
 * @description
 * `sugar.ts` turns one authored sugar node (`location` / `locations` /
 * `region` / `route`) into a GeoJSON `Feature`/`FeatureCollection`. These tests
 * pin the mapping table (geometry type + preserved coordinates + `{name,
 * description}` defaulting to `""`), the **structural-only** validation posture
 * (KTD6/R6 — a coordinate-*value* malformation must NOT error here, it is the
 * downstream schema's job), unknown-key rejection (R4), prototype-pollution
 * safety, `project()`, and purity.
 *
 * Imports the module directly (`../../src/model/sugar`) rather than the `../../src`
 * barrel — the barrel eagerly loads maplibre-gl and needs a `URL.createObjectURL`
 * shim this leaf test has no reason to pull in.
 */

import { describe, it, expect } from "vitest";
import {
  SUGAR_KEYS,
  detectSugarKey,
  project,
  expandGeoSugar,
  isSugarError,
  type SugarError,
} from "../../src/model/sugar";

/** Narrow an `expandGeoSugar` result to its success shape, failing loudly otherwise. */
function expectValue(result: ReturnType<typeof expandGeoSugar>) {
  if (isSugarError(result)) {
    throw new Error(`expected a value, got error: ${result.path}: ${result.message}`);
  }
  return result;
}

/** Narrow to a `SugarError`, failing loudly otherwise. */
function expectError(result: unknown): SugarError {
  if (!isSugarError(result)) {
    throw new Error(`expected a structured error, got: ${JSON.stringify(result)}`);
  }
  return result;
}

describe("SUGAR_KEYS", () => {
  it("is exactly the four V2-D2-named sugars", () => {
    expect([...SUGAR_KEYS]).toEqual(["location", "locations", "region", "route"]);
  });
});

describe("detectSugarKey — the 'exactly one' half of R5", () => {
  it("returns the single present sugar key", () => {
    expect(detectSugarKey({ type: "geojson", location: { coordinates: [0, 0] } })).toBe(
      "location",
    );
    expect(detectSugarKey({ type: "geojson", route: { coordinates: [[0, 0], [1, 1]] } })).toBe(
      "route",
    );
  });

  it("returns null when no sugar key is present", () => {
    expect(detectSugarKey({ type: "geojson", data: {} })).toBeNull();
    expect(detectSugarKey({})).toBeNull();
  });

  it("returns a structured error (not a throw) when more than one sugar key is present", () => {
    const result = detectSugarKey({
      type: "geojson",
      location: { coordinates: [0, 0] },
      region: { coordinates: [[[0, 0]]] },
    });
    const err = expectError(result);
    expect(err.message).toMatch(/location/);
    expect(err.message).toMatch(/region/);
    expect(typeof err.path).toBe("string");
  });

  it("is not fooled by inherited keys (prototype-safe presence check)", () => {
    // `location` lives on the prototype, not as an own key.
    const proto = { location: { coordinates: [0, 0] } };
    const source = Object.create(proto) as Record<string, unknown>;
    source["type"] = "geojson";
    expect(detectSugarKey(source)).toBeNull();
  });
});

describe("expandGeoSugar — the mapping table", () => {
  it("location → Feature<Point>, coordinates preserved, properties default to \"\"", () => {
    const result = expectValue(expandGeoSugar({ coordinates: [-74.006, 40.7128] }, "location"));
    expect(result.kind).toBe("location");
    expect(result.value).toEqual({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-74.006, 40.7128] },
      properties: { name: "", description: "" },
    });
  });

  it("location carries its own name/description into properties", () => {
    const result = expectValue(
      expandGeoSugar(
        { coordinates: [0, 0], name: "Origin", description: "null island" },
        "location",
      ),
    );
    expect((result.value as any).properties).toEqual({
      name: "Origin",
      description: "null island",
    });
  });

  it("locations → FeatureCollection with one Point Feature per item, each with its own name/description", () => {
    const result = expectValue(
      expandGeoSugar(
        [
          { coordinates: [0, 0], name: "A" },
          { coordinates: [1, 1], description: "second" },
        ],
        "locations",
      ),
    );
    expect(result.kind).toBe("locations");
    expect(result.value).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: { name: "A", description: "" },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [1, 1] },
          properties: { name: "", description: "second" },
        },
      ],
    });
  });

  it("region → Feature<Polygon> with ring nesting (Position[][]) preserved", () => {
    const rings = [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ];
    const result = expectValue(expandGeoSugar({ coordinates: rings, name: "R" }, "region"));
    expect(result.kind).toBe("region");
    expect(result.value).toEqual({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: rings },
      properties: { name: "R", description: "" },
    });
  });

  it("route → Feature<LineString> with the coordinate array preserved", () => {
    const line = [
      [0, 0],
      [1, 1],
      [2, 2],
    ];
    const result = expectValue(expandGeoSugar({ coordinates: line }, "route"));
    expect(result.kind).toBe("route");
    expect(result.value).toEqual({
      type: "Feature",
      geometry: { type: "LineString", coordinates: line },
      properties: { name: "", description: "" },
    });
  });

  it("preserves 3-element positions ([lng,lat,alt]) — not truncated (RFC 7946 §3.1.1)", () => {
    const point = expectValue(expandGeoSugar({ coordinates: [1, 2, 3] }, "location"));
    expect((point.value as any).geometry.coordinates).toEqual([1, 2, 3]);

    const route = expectValue(
      expandGeoSugar({ coordinates: [[1, 2, 3], [4, 5, 6]] }, "route"),
    );
    expect((route.value as any).geometry.coordinates).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });
});

describe("expandGeoSugar — structural validation (KTD6/R6)", () => {
  it("route with a single position → structural error naming the path", () => {
    const err = expectError(expandGeoSugar({ coordinates: [[0, 0]] }, "route"));
    expect(err.path).toContain("route.coordinates");
    expect(err.message).toMatch(/two|2|least/i);
  });

  it("locations not an array → structural error naming the path", () => {
    const err = expectError(
      expandGeoSugar({ coordinates: [0, 0] } as any, "locations"),
    );
    expect(err.path).toContain("locations");
    expect(err.message).toMatch(/array/i);
  });

  it("region.coordinates not an array of rings → structural error naming the path", () => {
    const err = expectError(expandGeoSugar({ coordinates: [0, 0] }, "region"));
    expect(err.path).toContain("region.coordinates");
    expect(err.message).toMatch(/ring|array/i);
  });
});

describe("expandGeoSugar — the dual-posture boundary (KTD6/R6)", () => {
  it("a 1-element position does NOT error in the expander (deferred to the schema)", () => {
    const result = expandGeoSugar({ coordinates: [5] }, "location");
    expect(isSugarError(result)).toBe(false);
    expect((expectValue(result).value as any).geometry.coordinates).toEqual([5]);
  });

  it("a string where a number belongs does NOT error in the expander", () => {
    const result = expandGeoSugar({ coordinates: ["nope", 2] }, "location");
    expect(isSugarError(result)).toBe(false);
    expect((expectValue(result).value as any).geometry.coordinates).toEqual(["nope", 2]);
  });

  it("a coordinate-value malformation inside a route position does NOT error", () => {
    const result = expandGeoSugar({ coordinates: [[0], [1]] }, "route");
    expect(isSugarError(result)).toBe(false);
  });
});

describe("expandGeoSugar — unknown-key rejection (R4)", () => {
  it("location with markerColor/zoom → error naming the accepted keys and pointing at paint/camera", () => {
    const err = expectError(
      expandGeoSugar({ coordinates: [0, 0], markerColor: "#f00", zoom: 12 }, "location"),
    );
    expect(err.message).toMatch(/coordinates/);
    expect(err.message).toMatch(/name/);
    expect(err.message).toMatch(/description/);
    expect(err.message).toMatch(/paint|camera/i);
    expect(err.path).toMatch(/markerColor|zoom/);
  });

  it("rejects styling/camera fields on region and route too", () => {
    expect(
      isSugarError(
        expandGeoSugar({ coordinates: [[[0, 0]]], fillColor: "#0f0" }, "region"),
      ),
    ).toBe(true);
    expect(
      isSugarError(expandGeoSugar({ coordinates: [[0, 0], [1, 1]], color: "#00f", width: 3 }, "route")),
    ).toBe(true);
  });

  it("rejects an unknown key on a locations item", () => {
    const err = expectError(
      expandGeoSugar([{ coordinates: [0, 0], markerColor: "#f00" }], "locations"),
    );
    expect(err.path).toMatch(/markerColor/);
  });
});

describe("expandGeoSugar — prototype-pollution safety (security)", () => {
  it("rejects __proto__ as a sugar-node key without mutating any prototype", () => {
    // JSON.parse creates an *own* `__proto__` data property — the realistic
    // parser threat model (unlike an object literal, which reparents instead).
    const node = JSON.parse('{"coordinates":[0,0],"__proto__":{"polluted":true}}');
    const result = expandGeoSugar(node, "location");
    expect(isSugarError(result)).toBe(true);
    // Global prototype untouched.
    expect(({} as any).polluted).toBeUndefined();
    expect((Object.prototype as any).polluted).toBeUndefined();
    // The returned error object's own prototype is unchanged.
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it("rejects constructor as a sugar-node key", () => {
    const node = JSON.parse('{"coordinates":[0,0],"constructor":{"bad":true}}');
    expect(isSugarError(expandGeoSugar(node, "location"))).toBe(true);
  });

  it("a valid expansion returns objects with an ordinary Object prototype", () => {
    const result = expectValue(expandGeoSugar({ coordinates: [0, 0] }, "location"));
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    expect(Object.getPrototypeOf((result.value as any).properties)).toBe(Object.prototype);
    expect(Object.getPrototypeOf((result.value as any).geometry)).toBe(Object.prototype);
  });
});

describe("project — narrows a richer node to {coordinates,name,description}", () => {
  it("drops markerColor/zoom from a LocationPoint", () => {
    const locationPoint = {
      coordinates: [-74.006, 40.7128],
      name: "NYC",
      description: "the big apple",
      markerColor: "#ff0000",
      zoom: 15,
    };
    expect(project(locationPoint)).toEqual({
      coordinates: [-74.006, 40.7128],
      name: "NYC",
      description: "the big apple",
    });
  });

  it("the projected node feeds the expander cleanly (no unknown-key rejection)", () => {
    const locationPoint = { coordinates: [0, 0], name: "n", markerColor: "#f00" };
    const result = expandGeoSugar(project(locationPoint), "location");
    expect(isSugarError(result)).toBe(false);
  });
});

describe("expandGeoSugar — purity", () => {
  it("expanding the same node twice yields deep-equal output", () => {
    const node = { coordinates: [1, 2, 3], name: "x", description: "y" };
    expect(expandGeoSugar(node, "location")).toEqual(expandGeoSugar(node, "location"));
  });

  it("does not mutate the input node", () => {
    const node = { coordinates: [1, 2], name: "x" };
    const before = JSON.parse(JSON.stringify(node));
    expandGeoSugar(node, "location");
    expect(node).toEqual(before);
  });

  it("does not mutate the input array for locations", () => {
    const nodes = [{ coordinates: [0, 0] }, { coordinates: [1, 1] }];
    const before = JSON.parse(JSON.stringify(nodes));
    expandGeoSugar(nodes, "locations");
    expect(nodes).toEqual(before);
  });
});
