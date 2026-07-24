---
status: pending
priority: p3
tags: [validation, json-schema, parser, review]
dependencies: []
---

# Phase 2 review: deferred findings

A recall-biased review of the Phase 2 diff (PR #47) surfaced these lower-severity items. The high-confidence bugs were fixed in `fix/phase-2-review-followups`; these were judged edge-case or design-decision and deferred.

## 1. Nested `$ref` inside a referenced definition is not resolved (parser)
`resolveReferences` returns `config.layers[name]` / `config.sources[name]` as-is without recursively resolving `$ref`s *inside* the referenced object (`yaml-parser.ts` ~729/742). So a global layer that itself contains `source: {$ref: "#/sources/s"}`, when pulled in via `{$ref: "#/layers/a"}`, keeps the inner unresolved `$ref`. Inline `$ref`s resolve; referenced-then-nested ones don't — inconsistent. Fix: run `resolveInObject` on the returned definition (guard against ref cycles).

## 2. ml-map CSS probe: async stylesheet + iframe document (D11 diagnostics)
The console-only CSS-missing probe (`ml-map.ts` ~406-429) measures synchronously against the ambient `document`, so it (a) false-warns when MapLibre CSS is loaded via an async `<link>` not yet applied, and (b) checks the wrong document when `<ml-map>` lives in an iframe with CSS in the inner document. Acceptable known limitations of a synchronous dev-only probe; a fuller fix would defer the check a frame and use `this.ownerDocument`/`defaultView`.

## 3. `any.schema.json` `oneOf` assumes structural mutual exclusivity (emit)
`emit-json-schema.ts` renames the union to `oneOf`, which requires exactly one branch to match. True today (type-discriminated + strict; root requires `pages`) but not structurally enforced; a future loosening could let a doc match two branches, making ajv reject what Zod's first-match `union` accepts. Consider a guard/test asserting mutual exclusivity, or revert to `anyOf`.

## 4. draft-07 `$ref` siblings ignored (emit, cosmetic)
`emit()` returns top-level `{title, description, $id, $ref, $defs}`; under draft-07, keywords sibling to `$ref` are ignored by strict consumers, so top-level `title`/`description`/`$id` are dropped. yaml-language-server associates by URL so this is cosmetic; if it matters, move `title`/`description` onto the `$defs/<name>` entry.

## 5. JSON Schema vs. validate disagree on paint-key typos (D8 surface)
`mlym validate` warns on `paint: { circle-radis: 8 }` (paint objects are walked), but the emitted JSON Schema leaves paint `additionalProperties: true`, so editors do NOT flag the same typo. This is the D8 strict/permissive decision surface — the two typo-protection surfaces disagree for paint. Resolve when D8 is ratified: either walk paint in the emitter too (accepting false-flags on exotic valid props) or stop walking paint in `collectWarnings` (losing the `circle-radis` warning). The emit-script docstring should also be corrected — it currently claims editors flag "layer keys," which is only true for the layer *envelope*, not paint.

## Work Log

- 2026-07-05: Filed from the Phase 2 PR #47 review. High-confidence fixes applied separately; these deferred for a later pass or the Phase 5 GeoJSON work (items 1 and 5 especially intersect it).
