/**
 * @file Snapshot tests for the emitted JSON Schema artifacts.
 *
 * These lock the generated JSON Schema contract so accidental changes to the
 * Zod source (or the emitter) surface as an explicit snapshot diff in review.
 *
 * The schemas are generate-on-build; this test builds them in memory via
 * `buildSchemas()` (no dependency on `pnpm build` having run). When an
 * intentional schema change lands, regenerate the snapshots with:
 *
 *     pnpm --filter @maplibre-yaml/core test -- -u
 */

import { describe, it, expect } from "vitest";
import {
  buildSchemas,
  serializeSchema,
  enforceStrict,
  SCHEMA_NAMES,
} from "../../scripts/emit-json-schema";

describe("enforceStrict — schema-node detection (no data-field corruption)", () => {
  it("does not inject strict keywords into a DATA field named `properties`", () => {
    // A JSON Schema for an object that has a data field literally named
    // `properties` (as every GeoJSON Feature does). The outer object is a real
    // schema node and is tightened, but its `properties` *map* is a container
    // of field schemas — it must NOT be mistaken for a schema node and have
    // `additionalProperties`/`patternProperties` injected into it.
    const node: Record<string, any> = {
      type: "object",
      properties: {
        type: { type: "string", const: "Feature" },
        properties: {
          type: "object",
          properties: { name: { type: "string" } },
        },
      },
      required: ["type", "properties"],
    };

    enforceStrict(node);

    const propsMap = node.properties as Record<string, unknown>;
    // The container map still holds exactly the declared data fields...
    expect(Object.keys(propsMap).sort()).toEqual(["properties", "type"]);
    // ...and was NOT corrupted with schema keywords.
    expect(propsMap).not.toHaveProperty("additionalProperties");
    expect(propsMap).not.toHaveProperty("patternProperties");
    // The outer object IS tightened (it is a genuine schema node).
    expect(node.additionalProperties).toBe(false);
    // The real inner object schema (the `properties` field's own shape) IS
    // tightened too.
    const inner = propsMap.properties as Record<string, unknown>;
    expect(inner.additionalProperties).toBe(false);
  });

  it("does not treat a bare property-name map (no `type`) as a schema", () => {
    // A node with a truthy `.properties` member but no `type: "object"` is not
    // a schema object and must be left untouched.
    const node: Record<string, any> = {
      properties: { foo: { type: "string" } },
    };
    enforceStrict(node);
    expect(node).not.toHaveProperty("additionalProperties");
    expect(node).not.toHaveProperty("patternProperties");
  });
});

describe("emitted JSON Schema artifacts", () => {
  const schemas = buildSchemas();

  it.each(SCHEMA_NAMES)("%s.schema.json matches snapshot", (name) => {
    expect(serializeSchema(schemas[name])).toMatchSnapshot();
  });

  it("carries stable metadata on every document", () => {
    for (const name of SCHEMA_NAMES) {
      const doc = schemas[name] as Record<string, unknown>;
      expect(doc.$schema).toBe("http://json-schema.org/draft-07/schema#");
      expect(doc.$id).toBe(
        `https://docs.maplibre-yaml.org/schema/latest/${name}.schema.json`,
      );
      expect(typeof doc.title).toBe("string");
      expect(typeof doc.description).toBe("string");
    }
  });

  it("keeps the x-* extension escape hatch on strict block objects", () => {
    // The map block object itself is strict (additionalProperties: false) with
    // an x-* pattern escape hatch (D8).
    const mapDef = (schemas.map.$defs as Record<string, any>).map;
    expect(mapDef.additionalProperties).toBe(false);
    expect(mapDef.patternProperties).toHaveProperty("^x-");
  });

  it("keeps passthrough objects (config) permissive to match Zod", () => {
    // MapConfigSchema is `.passthrough()` — arbitrary MapLibre options stay
    // legal so the JSON Schema does not reject what Zod accepts.
    const mapDef = (schemas.map.$defs as Record<string, any>).map;
    expect(mapDef.properties.config.additionalProperties).toBe(true);
  });

  it("emits `any` as a oneOf over the three document shapes", () => {
    const anyDef = (schemas.any.$defs as Record<string, any>).any;
    expect(Array.isArray(anyDef.oneOf)).toBe(true);
    expect(anyDef.oneOf).toHaveLength(3);
    expect(anyDef.anyOf).toBeUndefined();
  });
});
