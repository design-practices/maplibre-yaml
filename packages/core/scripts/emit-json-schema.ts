/**
 * @file Emit JSON Schema artifacts from the Zod source schemas.
 * @module @maplibre-yaml/core/scripts/emit-json-schema
 *
 * @description
 * Converts the canonical Zod schemas into per-block JSON Schema (draft-07)
 * documents and writes them to `packages/core/schemas/`. Run as part of the
 * core build (`postbuild`) so the emitted artifacts always track the Zod
 * source. These files are generate-on-build (git-ignored, published in the
 * npm package + docs site) — never hand-edit them.
 *
 * Emits:
 *  - `map.schema.json`             (MapBlockSchema — the `<ml-map>`/CLI unit)
 *  - `scrollytelling.schema.json`  (ScrollytellingBlockSchema)
 *  - `root.schema.json`            (RootSchema — a `pages:` document)
 *  - `any.schema.json`             (oneOf over the three, matching the
 *                                   Phase-1 `safeParseAny` dispatcher)
 *
 * ## Strictness (Decision D8)
 * The emitted schemas describe the **strict** shape: enumerated object nodes
 * get `additionalProperties: false` plus a `patternProperties: {"^x-": {}}`
 * escape hatch for `x-*` extension keys, so editors flag typo'd block/layer
 * keys while `x-*` extensions stay legal.
 *
 * The Zod `.passthrough()` objects — `MapConfigSchema` (arbitrary MapLibre GL
 * options) and the data-source schemas — are deliberately kept permissive
 * (`additionalProperties: true`, which already subsumes `x-*`). Forcing those
 * strict would (a) flag legitimate MapLibre options as errors and (b) break
 * the round-trip converter-fidelity guard, since the Zod runtime accepts them.
 * When the validation-ergonomics plan flips `.passthrough()` to warn-on-unknown
 * these will tighten automatically on the next regenerate. Either way JSON
 * Schema is advisory authoring assistance; `mlym validate` (Zod) is the source
 * of truth. See the plan `feat-json-schema-and-agent-affordances.md`.
 *
 * Because `.refine()`/`.superRefine()` logic does not convert, the JSON
 * Schema is necessarily *looser* than Zod for cross-field rules (e.g. the
 * geojson url/data/prefetchedData guard).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { MapBlockSchema } from "../src/schemas/map.schema";
import { ScrollytellingBlockSchema } from "../src/schemas/scrollytelling.schema";
import { RootSchema } from "../src/schemas/page.schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Output directory: packages/core/schemas */
const OUT_DIR = join(__dirname, "..", "schemas");

/** Canonical, stable base URL for hosted schemas (docs site). */
const SCHEMA_BASE_URL = "https://docs.maplibre-yaml.org/schema/latest";

type JsonSchema = Record<string, unknown>;

/**
 * Recursively enforce the strict object shape (D8):
 *  - enumerated object nodes get `additionalProperties: false`
 *  - plus `patternProperties: {"^x-": {}}` so `x-*` extension keys stay legal
 *
 * Skipped, to stay faithful to the Zod runtime and keep the round-trip guard
 * meaningful:
 *  - Records / catchall objects (`additionalProperties` is itself a schema,
 *    e.g. `z.record(...)`) — their value type is preserved.
 *  - `.passthrough()` objects (`additionalProperties === true`, e.g.
 *    `MapConfigSchema` and the source schemas) — kept permissive so real
 *    MapLibre options validate. `true` already permits `x-*` keys.
 */
function enforceStrict(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) enforceStrict(item);
    return;
  }
  if (node === null || typeof node !== "object") return;

  const obj = node as JsonSchema;

  // Only tighten plain enumerated object schemas. Records
  // (additionalProperties: <schema>) and passthrough objects
  // (additionalProperties: true) are left as the generator produced them.
  if (
    obj.properties &&
    typeof obj.properties === "object" &&
    obj.additionalProperties !== true &&
    typeof obj.additionalProperties !== "object"
  ) {
    obj.additionalProperties = false;
    const existingPattern =
      obj.patternProperties && typeof obj.patternProperties === "object"
        ? (obj.patternProperties as JsonSchema)
        : {};
    obj.patternProperties = { ...existingPattern, "^x-": {} };
  }

  // Recurse into every value (covers $defs, properties, anyOf/oneOf/allOf,
  // items, patternProperties, and schema-valued additionalProperties).
  for (const value of Object.values(obj)) enforceStrict(value);
}

/** Rewrite every `$ref` string prefixed with `from` to use `to` instead. */
function rewriteRefs(node: unknown, from: string, to: string): void {
  if (Array.isArray(node)) {
    for (const item of node) rewriteRefs(item, from, to);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const obj = node as JsonSchema;
  if (typeof obj.$ref === "string" && obj.$ref.startsWith(from)) {
    obj.$ref = to + obj.$ref.slice(from.length);
  }
  for (const value of Object.values(obj)) rewriteRefs(value, from, to);
}

/** Convert a Zod schema to a strict JSON Schema document with metadata. */
function emit(
  schema: z.ZodTypeAny,
  name: string,
  meta: { title: string; description: string },
): JsonSchema {
  const json = zodToJsonSchema(schema, {
    name,
    $refStrategy: "root",
    definitionPath: "$defs",
    target: "jsonSchema7",
  }) as JsonSchema;

  enforceStrict(json);

  // Prepend stable metadata. `$schema` (dialect) comes from the generator.
  const { $schema, ...rest } = json;
  return {
    $schema: $schema ?? "http://json-schema.org/draft-07/schema#",
    $id: `${SCHEMA_BASE_URL}/${name}.schema.json`,
    title: meta.title,
    description: meta.description,
    ...rest,
  };
}

/** The block names emitted, in stable order. */
export const SCHEMA_NAMES = ["map", "scrollytelling", "root", "any"] as const;
export type SchemaName = (typeof SCHEMA_NAMES)[number];

/**
 * Build all four JSON Schema documents in memory (no file I/O).
 * Shared by the file emitter and the test suite so both see identical output.
 */
export function buildSchemas(): Record<SchemaName, JsonSchema> {
  const map = emit(MapBlockSchema, "map", {
    title: "maplibre-yaml map block",
    description:
      "A single `type: map` block — the unit consumed by <ml-map src> and " +
      "by `mlym validate`. This is NOT a `pages:` root document.",
  });

  const scrollytelling = emit(ScrollytellingBlockSchema, "scrollytelling", {
    title: "maplibre-yaml scrollytelling block",
    description:
      "A single `type: scrollytelling` block with chapters — the unit " +
      "consumed by <ml-map src> and by `mlym validate`.",
  });

  const root = emit(RootSchema, "root", {
    title: "maplibre-yaml root (pages) document",
    description:
      "A top-level document with a `pages:` array (multi-page app). " +
      'Root documents omit "type" and use a top-level "pages:" array.',
  });

  // `any` mirrors the Phase-1 safeParseAny dispatcher: map | scrollytelling |
  // root, discriminated on the top-level `type` field (root has no `type`).
  const any = emit(
    z.union([MapBlockSchema, ScrollytellingBlockSchema, RootSchema]),
    "any",
    {
      title: "maplibre-yaml document (any block or root)",
      description:
        "Any maplibre-yaml document: a `type: map` block, a " +
        "`type: scrollytelling` block, or a `pages:` root document. Mirrors " +
        "the `safeParseAny` dispatcher used by <ml-map> and `mlym validate`.",
    },
  );
  // zod unions convert to `anyOf`; rename to `oneOf` since exactly one of the
  // three block/document shapes matches a given document (they are mutually
  // exclusive once additionalProperties is strict + discriminated on `type`).
  const anyDef = (any.$defs as JsonSchema | undefined)?.any as
    | JsonSchema
    | undefined;
  if (anyDef && Array.isArray(anyDef.anyOf)) {
    anyDef.oneOf = anyDef.anyOf;
    delete anyDef.anyOf;
    // The `$refStrategy: "root"` generator emits path-based internal refs like
    // `#/$defs/any/anyOf/0/...`; renaming the container to `oneOf` above would
    // dangle them. Rewrite every such ref to point at `oneOf` instead.
    rewriteRefs(any, "#/$defs/any/anyOf/", "#/$defs/any/oneOf/");
  }

  return { map, scrollytelling, root, any };
}

/** Serialize a schema document deterministically (2-space, trailing newline). */
export function serializeSchema(doc: JsonSchema): string {
  return JSON.stringify(doc, null, 2) + "\n";
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const schemas = buildSchemas();
  for (const name of SCHEMA_NAMES) {
    const doc = schemas[name];
    const file = join(OUT_DIR, `${name}.schema.json`);
    const serialized = serializeSchema(doc);
    writeFileSync(file, serialized, "utf-8");
    // eslint-disable-next-line no-console
    console.log(`  emitted schemas/${name}.schema.json (${serialized.length} bytes)`);
  }
}

// Only write files when executed directly (e.g. `tsx scripts/emit-json-schema.ts`),
// not when imported by tests.
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
