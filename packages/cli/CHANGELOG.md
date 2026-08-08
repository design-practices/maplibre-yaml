# @maplibre-yaml/cli

## 0.2.2

### Patch Changes

- Updated dependencies [328661a]
  - @maplibre-yaml/core@0.5.0

## 0.2.1

### Patch Changes

- 95ea3f1: Harden every HTML sink: shared attribute-safe escaping, a popup tag allowlist, and URL scheme guards.

  A document may be authored by someone other than the person whose browser renders it, and feature properties come from fetched data that is never trusted. Escaping was applied unevenly across the sinks, and three vectors were live.

  **New `escapeHtml` / `safeUrl` in core** (exported from the package root). One escaper, attribute-safe — quotes included — and DOM-free, so it works during SSR where the previous `document.createElement` approach did not. It replaces two divergent private copies: the popup builder's regex version escaped quotes, the `<ml-map>` error card's `textContent` version did not, which is exactly the difference between safe and unsafe in attribute position.

  **Popup builder.** Three fixes:
  - _Tag allowlist._ Popup content is `z.record(...)`, so the tag is a YAML **key** and nothing constrained it: `script:` emitted a real `<script>` block, and a key carrying attributes (`img src=x onerror=...`) injected them wholesale. Only the documented tags render now; anything else is dropped with a console warning. `iframe` is deliberately excluded — the builder never emitted one with a `src`, so nothing that worked stops working.
  - _URL scheme guards._ `javascript:alert(1)` contains no character escaping touches, and zod's `.url()` accepts it as well-formed, so it reached `href` intact and executed on click. `href` and `src` now pass through a scheme allowlist (http, https, mailto, tel, plus scheme-less relative references); an unsafe link degrades to its text, an unsafe image is dropped. The guard strips control characters first, because browsers do the same before resolving a scheme — `java\nscript:` navigates as `javascript:`.
  - _`target` and `rel`._ `target` is passthrough in the schema and was raw-interpolated into the attribute, so `_blank" onmouseover="…` broke out. It is now allowlisted to the four legal values, and `_blank` links carry `rel="noopener noreferrer"`.

  **Astro components.** The `Map`, `FullPageMap`, and `Scrollytelling` error cards interpolated validation messages and thrown-error text into `innerHTML` completely unescaped. Scrollytelling additionally interpolated chapter `title`, `id`, `image`, and `video` into markup and attributes. All escaped; media URLs get the scheme guard. These inline scripts carry a small deliberate copy of the escaper rather than importing it — they are `is:inline`, and the only import route sits inside the very `try` whose `catch` renders the error card.

  **CLI preview.** The debug panel rendered event type and payload — which carry feature properties from fetched sources — into `innerHTML` unescaped.

  Not addressed here, and deliberately so: `chapter.description` and `footer` are documented as HTML-bearing (`"HTML/markdown supported"`, `"Footer content (HTML)"`). Escaping them would break documented behavior, and choosing between an allowlist sanitizer and a trusted-author contract is a product decision, tracked separately. Both sites are now commented to say so.

- Updated dependencies [95ea3f1]
- Updated dependencies [f4c4bab]
  - @maplibre-yaml/core@0.4.1

## 0.2.0

### Minor Changes

- 141d3f1: Add a deprecation warning channel, and deprecate the interaction `action` fields (schema-truthfulness U8).

  `click.action`, `mouseenter.action`, and `mouseleave.action` are accepted by the schema but have never been dispatched at runtime. Rather than remove them and break existing documents, they now emit a deprecation warning naming the event to listen for instead, and are scheduled for removal in v2. The config still parses.

  **core:** `ValidationWarning` gains `kind: "deprecation"`. The hardcoded legacy-refresh check is replaced by a deprecation table — `field` plus an `applies` predicate — so deprecating a field is a data change rather than another special case in the walk; the legacy top-level `refreshInterval`/`updateStrategy`/`updateKey` warnings fold into it unchanged and now carry the new kind. The rules are scoped to `interactive.{click,mouseenter,mouseleave}.action`, so scrollytelling chapter actions, which share the field name, are untouched.

  **cli:** deprecations are exempt from strict promotion. `mlym validate` promotes warnings to errors under CI, and without this exemption 0.4.0 would hard-fail the build of every existing user of `click.action` on the release that deprecates it — defeating the point of a warning window. A new `--strict-deprecations` flag opts back in. The exemption is narrow: unknown-key and expression warnings still promote under CI exactly as before. The kind survives into both JSON output and the SARIF property bag, so deprecations are distinguishable in code-scanning results rather than only in message text.

- 141d3f1: Publish the YAML contract as machine-readable JSON Schema and ship the agent- and editor-facing affordances built on top of it. The Zod schemas already carried rich `.describe()` annotations; this converts and publishes them so authors get in-editor autocomplete and validation for free, and agents get a stable contract to generate against.

  **core: emit per-block JSON Schema at build time.** A new build step (`scripts/emit-json-schema.ts`, run by `pnpm build` after `tsup`) converts the Zod source into draft-07 JSON Schema documents — `map.schema.json` (`MapBlockSchema`), `scrollytelling.schema.json`, `root.schema.json` (the `pages:` document), and `any.schema.json` (a `oneOf` over the three, mirroring the Phase-1 `safeParseAny` dispatcher). `root.schema.json` emitted cleanly (~157 KB pretty-printed; the recursive `MixedBlock` is handled by `$ref` reuse, not inlined), so nothing was deferred. Per decision D7 these are generate-on-build: `packages/core/schemas/*.json` is git-ignored and regenerated by CI/build, never committed. They ship in the npm package (added to `files`) and are importable via a new `"./schemas/json/*"` export (e.g. `@maplibre-yaml/core/schemas/json/map.schema.json`).

  Per decision D8 the emitted schemas describe the **strict** shape — enumerated object nodes get `additionalProperties: false` plus a `patternProperties: {"^x-": {}}` escape hatch, so editors flag typo'd keys while `x-*` extensions stay legal. The Zod `.passthrough()` objects (`MapConfigSchema`'s arbitrary MapLibre options and the source schemas) are kept permissive to match the runtime, so the JSON Schema never rejects what `mlym validate` accepts; they tighten automatically when the validation-ergonomics work flips passthrough to warn-on-unknown. JSON Schema is advisory authoring assistance — `mlym validate` (Zod) remains the source of truth, since `.refine()`/`.superRefine()` cross-field rules do not convert.

  **cli: new `mlym schema [map|scrollytelling|root|any]` command.** Prints the JSON Schema resolved from the _installed_ `@maplibre-yaml/core` package, guaranteeing it matches the version `mlym validate` enforces; `--out <file>` writes it (creating parent directories). This is the offline / air-gapped path and the natural hook for future migration tooling.

  **Editor integration (zero-install).** Every CLI scaffold template and every canonical config in the docs now carries a `# yaml-language-server: $schema=...` modeline as its first line, so opening one in any `yaml-language-server`-backed editor (VS Code's Red Hat YAML extension, Neovim, JetBrains) gives autocomplete, hover docs, and inline validation with no project setup. New docs pages cover the modeline convention, the VS Code `yaml.schemas` settings-block alternative, and the generate → `mlym validate -f json` → repair agent loop with its structured `{ path, message, line, column }` error contract.

  **Agent resources.** The docs build now generates stable schema URLs (`/schema/latest/<block>.schema.json` plus versioned `/schema/v<major.minor>/`) and `llms.txt` / `llms-full.txt` from the same sources as the human docs, so they can never go stale. The content states explicitly the three things agents got wrong: `<ml-map src>` expects a `type: map` block (not a `pages:` root document), popups use the tag-array DSL (with a complete example), and named sources are referenced by bare name.

  Guarding all of it: snapshot tests over the generated schemas (regenerate with `pnpm --filter @maplibre-yaml/core test -- -u`) and a round-trip converter-fidelity test that validates every docs config and CLI template against _both_ the Zod parser and the generated JSON Schema via `ajv`.

- 141d3f1: Validation now delivers what it promised: real source positions, actionable type errors, and a warn-first typo channel.

  **Line/column positions, end to end.** The parser now reads YAML through the `yaml` document API with a `LineCounter`, so every error carries `{ line, column }`. YAML syntax errors copy the library's `linePos`; Zod errors map each issue `path` back to a source position via `doc.getIn(path, true)` → node range → `LineCounter` (falling back to the nearest ancestor node, and finally the document root, when a node is missing — e.g. a missing required key). Positions flow through the parser `ParseError`, the CLI human formatter (`at line 12, column 7`), and JSON/SARIF output (`region.startLine`/`startColumn`).

  **Discriminated layer union with did-you-mean.** The layer schema is now a `z.discriminatedUnion("type", …)`, so `type: circl` yields `Unknown layer type "circl". Valid types: circle, line, fill, symbol, raster, fill-extrusion, heatmap, hillshade, background. Did you mean "circle"?` instead of "Value does not match any of the expected formats". The same treatment covers unknown **source** types and the block-type dispatcher (`safeParseAny`). Suggestions use a small hand-rolled Levenshtein (distance ≤ 2, no new dependency).

  **Warn-first unknown-key detection (new `warnings` channel).** `ParseResult` gains a `warnings: ValidationWarning[]` channel alongside `errors`. After normal validation, a schema-aware walk diffs authored keys against each schema's known keys and emits **warnings** (never hard errors) for unknowns, with did-you-mean suggestions — so `circle-radis: 8` is finally caught. `x-*`-prefixed keys are always exempt at every level (the extension escape hatch). The intentional MapLibre `config` passthrough is not flagged. This is additive and warn-only; it does not flip to hard-strict by default.

  **Deprecation warning for the legacy refresh fields.** Using top-level `refreshInterval` / `updateStrategy` / `updateKey` on a GeoJSON source now emits a deprecation warning pointing at the `refresh:` block equivalent. The legacy fields still work; docs now teach only the nested form.

  **Bounded expression validation.** The expression operator (first array element) is checked against the known MapLibre operator list with did-you-mean, and obvious arity-zero mistakes are flagged — both as warnings. Full expression type-checking remains out of scope.

  **Root-level `$ref` sources are reachable.** A layer's `source:` now accepts `{ $ref: "#/sources/name" }`, resolved against the root `sources:` map at parse time; a dangling reference errors with a did-you-mean suggestion and the list of defined sources.

  **`<ml-map>` developer diagnostics.** Parser warnings are logged to `console.warn` (never the on-map error card). Two classic silent-blank-map failures are also detected on the console: a zero-height host element, and a missing MapLibre stylesheet (probed via the `.maplibregl-canary` technique).

  **CLI: CI-strict by default.** `mlym validate` now promotes warnings to errors automatically when `CI` is truthy (overridable with `--no-strict`); `--strict` still forces promotion anywhere. Warnings are printed in human, JSON, and SARIF output with line/column, as `warning`-level results.

### Patch Changes

- Updated dependencies [141d3f1]
- Updated dependencies [141d3f1]
- Updated dependencies [141d3f1]
- Updated dependencies [f012d2c]
- Updated dependencies [141d3f1]
- Updated dependencies [141d3f1]
- Updated dependencies [0a605d1]
- Updated dependencies [141d3f1]
- Updated dependencies [ff94d4f]
- Updated dependencies [fda8aad]
- Updated dependencies [141d3f1]
  - @maplibre-yaml/core@0.4.0

## 0.1.13

### Patch Changes

- 8511427: The CLI now validates and previews every block type it scaffolds, and preview renders with the locally installed core instead of a stale CDN pin.

  **core: new `YAMLParser.safeParseAny(yaml)` block dispatcher (also exported as `safeParseAny`).** Core exposed `safeParseMapBlock` / `safeParseScrollytellingBlock` / `safeParse` but no "detect `type:` and validate" entry point, so every consumer had to guess which schema a document needed. `safeParseAny` dispatches on the document's top-level `type:` field (`map` → MapBlockSchema, `scrollytelling` → ScrollytellingBlockSchema, no `type:` but `pages:` → RootSchema) and returns a discriminated `{ blockType, result }`. An unrecognized `type:` produces a clear error listing the valid values instead of a cryptic literal mismatch. Never throws.

  **cli: `validate` accepts everything `init` scaffolds.** `mlym validate story.yaml` on the CLI's own story template (`type: scrollytelling`) failed with a type-literal error because the validator called `safeParseMapBlock` unconditionally; root `pages:` documents were equally unsupported. Both now validate via `safeParseAny`. Exit-code semantics are unchanged.

  **cli: `preview` serves the locally installed core.** The preview page's import map hardcoded `https://esm.sh/@maplibre-yaml/core@0.1.2/dist/register.js` — preview rendered with a core two minors behind the one that validated the config. Preview now resolves the installed `@maplibre-yaml/core` and serves its browser register bundle through the dev server; only if local resolution fails does it fall back to esm.sh pinned to the _installed_ version read from the package's own package.json. Previewing a non-map document (e.g. the story template) now shows "visual preview currently supports only `type: map` blocks" instead of a misleading validation error, and the error overlay reflects the latest reload instead of the first load.

  **cli: SARIF output reports the real CLI version.** `--format sarif` hardcoded `version: '0.1.0'`; it now reads the version from the CLI's package.json like the `--version` flag does.

  **cli: astro template accuracy.** The template is described as what it is — an Astro project rendering the `<ml-map>` web component — its `@maplibre-yaml/core` dependency is pinned to `^0.2.0` instead of `latest`, and `init` next-steps text now matches what each template actually supports.

- Updated dependencies [ab8ba89]
- Updated dependencies [8511427]
- Updated dependencies [4ed6c5e]
- Updated dependencies [1daaee2]
- Updated dependencies [291f852]
- Updated dependencies [d87a7c5]
- Updated dependencies [f716577]
  - @maplibre-yaml/core@0.3.0

## 0.1.12

### Patch Changes

- Updated dependencies [937738a]
  - @maplibre-yaml/core@0.2.0

## 0.1.0

### Patch Changes

- Updated dependencies [e7e1126]
  - @maplibre-yaml/core@0.1.0
