# feat: Validation Ergonomics — Deliver What Validation Promises

**Phase:** 2 (parallel) of the [meta-plan](./meta-plan-stabilization-and-roadmap.md)
**Status:** Approved (sequencing confirmed by Mario)
**Depends on:** Phase 1 (block dispatcher); interacts with [rfc-schema-versioning.md](./rfc-schema-versioning.md) for anything breaking

## Overview

Validation is the product's flagship claim ("catch errors before MapLibre chokes") and it is half-kept. This plan closes the gap with four changes: real line/column positions, a discriminated layer union, unknown-key detection with suggestions, and consolidation of the duplicate refresh fields. Rollout is warn-first so nothing breaks existing files before the versioning policy exists.

## Problem Statement

Verified in the assessment:

1. **Positions are promised, never delivered.** `ParseError` declares `line?`/`column?` (`yaml-parser.ts:113-118`) but `formatZodErrors` returns only `{path, message}` (`:674-677`), and YAML syntax errors are stringified without extracting the position the `yaml` library provides (`:186-190`). The CLI's human/SARIF formatters have location slots that are effectively always empty.
2. **Layer errors are useless.** Layers are a plain `z.union`, so `type: circl` yields "Value does not match any of the expected formats" instead of "unknown layer type 'circl' — did you mean 'circle'?".
3. **Typos validate silently.** Every layer/source schema is `.passthrough()`, so `circle-radis: 8` is accepted and silently ignored. The hundreds of hand-transcribed paint/layout properties in `layer.schema.ts` currently buy editor types but zero typo protection — the schema's main cost with none of its main benefit.
4. **Two ways to say refresh.** Legacy top-level `refreshInterval`/`updateStrategy`/`updateKey` coexist with the nested `refresh:` block (`source.schema.ts:298-317`).
5. (Inception-era open question, `project-memory/outstanding-questions.md`) **Expression validation** stops at "array starting with a string", so bad expressions surface as runtime MapLibre errors.

## Proposed Solution

### 1. Line/column positions end-to-end

- Parse with `yaml`'s document API keeping the CST/`LineCounter` (the library already computes offsets; we discard them).
- YAML syntax errors: copy `error.linePos` into `ParseError.line/column`.
- Zod errors: map each issue's `path` back to the source position via the document's node lookup (`doc.getIn(path, true)` → node range → LineCounter). Fall back to path-only when lookup misses (e.g. errors on missing keys point at the parent node).
- Surface positions in: parser `ParseError`, `<ml-map>` error card, CLI human formatter (`file.yaml:12:5`), JSON/SARIF output (slots already exist).

### 2. Discriminated layer union

- Replace the layer `z.union` with `z.discriminatedUnion("type", [...])`.
- Wrap the parse so an unrecognized `type` produces: `Unknown layer type "circl". Valid types: circle, line, fill, symbol, raster, fill-extrusion, heatmap, hillshade, background. Did you mean "circle"?` (nearest-match via Levenshtein ≤ 2).
- Same treatment for source `type` and block `type` (the Phase-1 `safeParseAny` dispatcher already needs the block-level version).

### 3. Unknown-key detection (warn-first)

- Introduce a shared `strictWithWarnings(schema)` helper: validate with the schema as today, then diff actual keys against the schema's known keys and emit **warnings** (not errors) for unknowns, with did-you-mean suggestions against the known-key list.
- **Always exempt `x-*` prefixed keys** at every level — this is the extension escape hatch the map-party spec assumes (`x-map-party`), and adopting it now costs nothing.
- Plumbing: parser gains a `warnings: ValidationWarning[]` channel alongside errors. CLI prints warnings in human/json/sarif (`--strict` already exists and promotes warnings to errors — exactly the right hook). `<ml-map>` logs warnings to console (not the error card).
- **Not in this plan:** flipping to hard-strict by default. That is a breaking change to the authored contract; per meta-plan D4 it waits for the versioning policy and most likely rides the GeoJSON alignment release (Phase 5), by which point users will have had warn-mode telling them about their typos for a full release cycle.

### 4. Consolidate refresh fields

- Emit a deprecation warning (via the new warnings channel) when legacy `refreshInterval`/`updateStrategy`/`updateKey` are used, pointing at the `refresh:` block equivalent. Removal is deferred to the versioning policy. Docs updated to show only the nested form.

### 5. Expression validation — bounded improvement

- Full MapLibre expression type-checking is out of scope (MapLibre itself owns that). Cheap wins now: validate the expression *operator* (first array element) against the known-operator list with did-you-mean, and validate obvious arity-zero mistakes. Resolves the inception-era open question with an explicit "this far, no further" note in `outstanding-questions.md`.

### 6. Error-card upgrades (`<ml-map>`)

Two detections for the classic silent-blank-map failures, shown as console warnings + a dev-only badge in the card area:
- Host element height is 0 after mount → "your `<ml-map>` has zero height; add e.g. `ml-map { height: 400px }`".
- `maplibregl` canvas present but no MapLibre CSS detected (probe a known class's computed style) → "MapLibre CSS is not loaded".

## Testing strategy

- Fixture-driven: a directory of bad YAML files, each with expected `{line, column, message}` snapshots — doubles as regression corpus and documentation of error quality.
- Warn-channel tests: unknown key produces warning + suggestion; `x-anything` produces none; `--strict` exits 1.
- Discriminated-union messages snapshot-tested (these strings are product surface; treat changes as reviewable).
- JSON Schema regeneration (Phase 2 sibling plan) after the discriminated union lands — discriminated unions convert to cleaner `oneOf`+`const` JSON Schema, improving editor autocomplete too.

## Out of scope

- Hard-strict (`additionalProperties: false`) by default — gated on versioning RFC + Phase 5.
- Removing legacy refresh fields — same gate.
- Full expression type-checking.

## Open questions for review

1. Warning UX in the browser: console-only, or a dismissible dev badge on the map? (Recommend console-only; badge risks shipping to production pages.)
2. Should `--strict` become the default in CI contexts (detect `CI=true`)? Recommend yes — warnings that only humans see never get fixed.
