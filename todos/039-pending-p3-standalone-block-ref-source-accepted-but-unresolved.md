---
status: pending
priority: p3
tags: [parser, validation, sources, dx]
dependencies: []
---

# Standalone map block accepts a `{$ref}` source it cannot resolve

## Problem Statement

Phase 2 (todo 035 / decision D10) made `{$ref: "#/sources/<name>"}` in a layer's `source:` field resolve against **root-level** `sources:` in a `pages:` document, with a dangling-ref error + did-you-mean. That works correctly for root documents (`resolveReferences` runs and throws on a missing target).

But a **standalone map block** (validated via `safeParseMapBlock` / `mlym validate` on a `type: map` file) also schema-accepts `source: {$ref: "#/sources/foo"}` — `SourceReferenceSchema` is in the layer source union — yet no reference resolution runs for a bare block, so the `$ref` is neither resolved nor flagged as dangling. It silently passes validation and would misbehave at render.

The documented pattern for standalone blocks is block-level bare-name sources (`sources:` inside the block + `source: foo`), so `$ref` in a standalone block is arguably out of contract — but accepting an unresolvable shape without any warning is inconsistent with the strict/warn direction of the rest of the validator.

## Proposed Action

One of:
1. In `safeParseMapBlock` (and the map-block path of `safeParseAny`), resolve `$ref` sources against the block's own `sources:` and emit the same dangling-ref error/did-you-mean when the target is missing; or
2. Emit a warning that `$ref` sources are only resolved in `pages:` root documents, pointing standalone-block authors at the bare-name form.

Option 1 is more consistent (make it work everywhere); option 2 is cheaper.

## Acceptance Criteria

A standalone `type: map` file with a `source: {$ref: "#/sources/missing"}` either resolves against the block's sources or produces a clear validation error/warning — it does not silently pass.

## Work Log

- 2026-07-05: Found during Phase 2 integration end-to-end verification. Root-document `$ref` resolution + dangling detection confirmed working; this is the standalone-block edge only.
