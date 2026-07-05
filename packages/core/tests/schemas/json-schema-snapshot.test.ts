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
  SCHEMA_NAMES,
} from "../../scripts/emit-json-schema";

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
