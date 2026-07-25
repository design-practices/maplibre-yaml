---
"@maplibre-yaml/core": minor
"@maplibre-yaml/cli": minor
---

Validation now delivers what it promised: real source positions, actionable type errors, and a warn-first typo channel.

**Line/column positions, end to end.** The parser now reads YAML through the `yaml` document API with a `LineCounter`, so every error carries `{ line, column }`. YAML syntax errors copy the library's `linePos`; Zod errors map each issue `path` back to a source position via `doc.getIn(path, true)` → node range → `LineCounter` (falling back to the nearest ancestor node, and finally the document root, when a node is missing — e.g. a missing required key). Positions flow through the parser `ParseError`, the CLI human formatter (`at line 12, column 7`), and JSON/SARIF output (`region.startLine`/`startColumn`).

**Discriminated layer union with did-you-mean.** The layer schema is now a `z.discriminatedUnion("type", …)`, so `type: circl` yields `Unknown layer type "circl". Valid types: circle, line, fill, symbol, raster, fill-extrusion, heatmap, hillshade, background. Did you mean "circle"?` instead of "Value does not match any of the expected formats". The same treatment covers unknown **source** types and the block-type dispatcher (`safeParseAny`). Suggestions use a small hand-rolled Levenshtein (distance ≤ 2, no new dependency).

**Warn-first unknown-key detection (new `warnings` channel).** `ParseResult` gains a `warnings: ValidationWarning[]` channel alongside `errors`. After normal validation, a schema-aware walk diffs authored keys against each schema's known keys and emits **warnings** (never hard errors) for unknowns, with did-you-mean suggestions — so `circle-radis: 8` is finally caught. `x-*`-prefixed keys are always exempt at every level (the extension escape hatch). The intentional MapLibre `config` passthrough is not flagged. This is additive and warn-only; it does not flip to hard-strict by default.

**Deprecation warning for the legacy refresh fields.** Using top-level `refreshInterval` / `updateStrategy` / `updateKey` on a GeoJSON source now emits a deprecation warning pointing at the `refresh:` block equivalent. The legacy fields still work; docs now teach only the nested form.

**Bounded expression validation.** The expression operator (first array element) is checked against the known MapLibre operator list with did-you-mean, and obvious arity-zero mistakes are flagged — both as warnings. Full expression type-checking remains out of scope.

**Root-level `$ref` sources are reachable.** A layer's `source:` now accepts `{ $ref: "#/sources/name" }`, resolved against the root `sources:` map at parse time; a dangling reference errors with a did-you-mean suggestion and the list of defined sources.

**`<ml-map>` developer diagnostics.** Parser warnings are logged to `console.warn` (never the on-map error card). Two classic silent-blank-map failures are also detected on the console: a zero-height host element, and a missing MapLibre stylesheet (probed via the `.maplibregl-canary` technique).

**CLI: CI-strict by default.** `mlym validate` now promotes warnings to errors automatically when `CI` is truthy (overridable with `--no-strict`); `--strict` still forces promotion anywhere. Warnings are printed in human, JSON, and SARIF output with line/column, as `warning`-level results.
