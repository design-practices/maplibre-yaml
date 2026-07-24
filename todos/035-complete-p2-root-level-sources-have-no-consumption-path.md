---
status: complete
priority: p2
issue_id: 035
tags: [core, schema, validation, sources, docs]
dependencies: []
---

# Root-level sources: have no consumption path

## Problem Statement

A root document can declare named sources at the top level (`sources:` next to `pages:`), but no layer can actually reach them:

- `source: "#/sources/x"` (JSON-pointer-style string) fails validation: `BaseLayerPropertiesSchema.source` is `z.union([LayerSourceSchema, z.string()])` (`packages/core/src/schemas/layer.schema.ts:250`), so the string itself parses, but at render time bare/pointer strings are resolved only against the *block-level* `sources:` map — a `#/sources/x` key never exists there, so `LayerManager.addLayer` throws "Source ... not found".
- `{ $ref: "#/sources/x" }` objects in a layer's `source:` field fail validation outright: `$ref` is not a member of `LayerSourceSchema`, and schema validation runs *before* `YAMLParser.resolveReferences` (`packages/core/src/parser/yaml-parser.ts:217,293,648`), so the reference is rejected before it could ever be resolved.
- Bare names (`source: boundary`) resolve only against the block-level `sources:` map added in 0.2.0.

Root-level named sources are therefore unreachable from layers — dead configuration surface that validates (as a root key) but can never be consumed.

## Options

1. Make layer-level `source: { $ref: ... }` (or `#/sources/x` strings) validate, by either resolving references *before* schema validation or admitting a `$ref` variant in the layer source union and resolving it afterward.
2. Drop root-level `sources:` from the docs and schema entirely, standardizing on block-level `sources:` (which works and is what the docs now teach).

## Reference

Docs were corrected in Workstream F (plans/fix-shipped-but-broken.md) to teach block-level `sources:`; this todo tracks the leftover root-level surface.

## Acceptance Criteria

Either a layer can reference a root-level named source end-to-end (validate + render), or root-level `sources:` is removed from schema and docs with a deprecation note.

## Work Log

- 2026-07-04: Created during Workstream G (repo hygiene) of plans/fix-shipped-but-broken.md.
- 2026-07-05: **Resolved** via Option 1 (decision D10) in
  `plans/feat-validation-ergonomics.md` (item 7). Changes:
  - Added `SourceReferenceSchema` (`{ $ref: string }`) and admitted it into the
    layer `source:` union in `packages/core/src/schemas/layer.schema.ts`, so a
    layer-level `source: { $ref: "#/sources/name" }` now validates.
  - `YAMLParser.resolveReferences` already walks and resolves
    `{ $ref: "#/sources/name" }` against the root `sources:` map; a dangling
    reference now throws a clear error with a did-you-mean suggestion and the
    list of defined source names (`packages/core/src/parser/yaml-parser.ts`).
  - Documented the root-level `$ref` source path and the dangling-ref error in
    `docs/src/content/docs/schema/root.mdx`.
  - Tests: `packages/core/tests/parser/validation-ergonomics.test.ts` covers a
    valid root-level `$ref` source resolving end-to-end and a dangling `$ref`
    erroring with a suggestion.
  A layer can now reference a root-level named source end-to-end (validate +
  resolve), satisfying the acceptance criteria.
