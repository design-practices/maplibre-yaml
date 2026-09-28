/**
 * @file Every user-facing schema key carries a `.describe()`.
 *
 * The docs site's YAML reference (docs/scripts/generate-yaml-reference.ts) is
 * generated from `buildReferenceSchema()` at build time, so it cannot drift
 * from the validator — but it can only be as good as the descriptions. This
 * test pins that: a new key without a description fails here, in `pnpm test`,
 * rather than shipping as a blank entry in the reference and in editors'
 * hover docs (the published JSON Schema carries the same text).
 *
 * Exempt, by design:
 *  - `paint` / `layout` keys — MapLibre's own properties; the reference links
 *    each to the MapLibre style spec instead.
 *  - GeoJSON internals (format v2's strict RFC 7946 `data`) — documented by
 *    the RFC, rendered as one `GeoJSON` type.
 *  - `$ref` / `$html` marker keys, which are syntax rather than settings.
 */

import { describe, it, expect } from "vitest";
import { buildReferenceSchema } from "../../scripts/emit-json-schema";

type Schema = Record<string, any>;

const GEOJSON_TYPES = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
  "Feature",
  "FeatureCollection",
]);

function collectUndescribed(doc: Schema): string[] {
  const resolve = (ptr: string): Schema | undefined => {
    let node: any = doc;
    for (const part of ptr.replace(/^#\//, "").split("/")) {
      node = node?.[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    }
    return node;
  };

  const isGeoJSONObject = (node: Schema): boolean => {
    const t = node.properties?.type;
    const values: unknown[] = t?.enum ?? (t?.const !== undefined ? [t.const] : []);
    return values.some((v) => GEOJSON_TYPES.has(String(v)));
  };

  const found = new Set<string>();
  const visited = new Set<Schema>();

  const walk = (node: Schema | undefined, path: string): void => {
    if (!node || typeof node !== "object" || visited.has(node)) return;
    visited.add(node);
    if (typeof node.$ref === "string") return walk(resolve(node.$ref), path);

    if (node.properties && !isGeoJSONObject(node)) {
      for (const [key, child] of Object.entries<Schema>(node.properties)) {
        const childPath = path ? `${path}.${key}` : key;
        if (key === "paint" || key === "layout") continue;
        if (!key.startsWith("$")) {
          const ownDescription = child.description;
          // A $ref without its own text inherits the target's — acceptable
          // only when the target is the same key (see the reference generator).
          const inherited =
            typeof child.$ref === "string" &&
            child.$ref.split("/").pop() === key &&
            resolve(child.$ref)?.description;
          if (!ownDescription && !inherited) found.add(childPath);
        }
        walk(child, childPath);
      }
    }
    for (const key of ["items", "additionalProperties"]) {
      const child = node[key];
      if (child && typeof child === "object" && !Array.isArray(child)) {
        walk(child, `${path}${key === "items" ? "[]" : ".<key>"}`);
      }
    }
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      if (Array.isArray(node[key])) for (const b of node[key]) walk(b, path);
    }
  };

  walk(doc.$defs.reference, "");
  return [...found].sort();
}

describe("schema descriptions (the generated YAML reference's source text)", () => {
  it("covers all four document shapes, including format v2", () => {
    const doc = buildReferenceSchema();
    const shapes = (doc.$defs as Schema).reference.anyOf as Schema[];
    expect(shapes).toHaveLength(4);
    expect(shapes[1]!.properties.version.const).toBe(2);
    expect(Object.keys(shapes[1]!.properties)).toEqual(
      expect.arrayContaining(["style", "runtime"]),
    );
  });

  it("gives every user-facing key a .describe()", () => {
    expect(collectUndescribed(buildReferenceSchema())).toEqual([]);
  });
});
