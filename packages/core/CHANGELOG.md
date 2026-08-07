# @maplibre-yaml/core

## 0.4.0

### Minor Changes

- 141d3f1: Make `controls.attribution` render a real attribution control (schema-truthfulness U3). Previously the field validated but did nothing at runtime — the first of the "accepted but dead" fields the 0.4.0 truthfulness work closes.

  `ControlsManager` gains an attribution branch (default position `bottom-right`) that constructs MapLibre's `AttributionControl`, exported through the maplibre-gl interop shim. When `controls.attribution` is configured, the map is constructed with `attributionControl: false` so MapLibre's built-in attribution does not double-render; the default still appears when the control is absent. An explicit `config.attributionControl: true` conflicting with `controls.attribution` resolves in favor of the control with a console warning.

  The attribution control config now accepts `compact` and `customAttribution` passthrough options (previously stripped as unknown keys), so they reach the constructed control.

- 141d3f1: Wire `click.flyTo` to the camera (schema-truthfulness U4). The field has been in the layer schema — with a documented example — since interactivity shipped, but the click handler never read it: configuring `flyTo` validated cleanly and did nothing. Clicking an interactive layer now animates the camera, defaulting the center to the clicked point and honoring `center`, `zoom`, and `duration`.

  Click dispatch is now **registry-shaped**, in a new internal `renderer/interactions.ts`: interactions are named entries (`popup`, `flyTo`) pairing a `select` (where the config lives) with a `run` (what it does), dispatched in registry order rather than through a chain of `if` branches in the click handler. Popup runs before flyTo, so a layer configuring both opens the popup at the clicked point and lets it travel with the camera. Adding an interaction means adding an entry, and the module is scoped so the planned interactions-package extraction moves it wholesale.

  An interaction is considered configured only when its selected config is truthy, so a present-but-disabled value (the shape `hover.highlight: false` takes) does not run. `flyTo` omits `zoom`/`duration` when unset so MapLibre's defaults apply, and both accept `0` as a meaningful value.

  These symbols are internal — deliberately absent from the package barrel. Extensibility remains eject-to-JS plus slots, not a plugin registry.

  Multi-feature clicks continue to resolve to the topmost feature, and the `layer:click` event still fires for every click regardless of which interactions are configured.

- 141d3f1: Add a deprecation warning channel, and deprecate the interaction `action` fields (schema-truthfulness U8).

  `click.action`, `mouseenter.action`, and `mouseleave.action` are accepted by the schema but have never been dispatched at runtime. Rather than remove them and break existing documents, they now emit a deprecation warning naming the event to listen for instead, and are scheduled for removal in v2. The config still parses.

  **core:** `ValidationWarning` gains `kind: "deprecation"`. The hardcoded legacy-refresh check is replaced by a deprecation table — `field` plus an `applies` predicate — so deprecating a field is a data change rather than another special case in the walk; the legacy top-level `refreshInterval`/`updateStrategy`/`updateKey` warnings fold into it unchanged and now carry the new kind. The rules are scoped to `interactive.{click,mouseenter,mouseleave}.action`, so scrollytelling chapter actions, which share the field name, are untouched.

  **cli:** deprecations are exempt from strict promotion. `mlym validate` promotes warnings to errors under CI, and without this exemption 0.4.0 would hard-fail the build of every existing user of `click.action` on the release that deprecates it — defeating the point of a warning window. A new `--strict-deprecations` flag opts back in. The exemption is narrow: unknown-key and expression warnings still promote under CI exactly as before. The kind survives into both JSON output and the SARIF property bag, so deprecations are distinguishable in code-scanning results rather than only in message text.

- 141d3f1: Implement `hover.highlight` (schema-truthfulness U5). The field validated and did nothing: hovering a feature now visibly highlights it.

  Highlighting is driven by `mousemove` rather than `mouseenter`, because MapLibre fires `mouseenter` once when the pointer enters a layer, not once per feature — so it cannot tell which feature is under the cursor as you move across them. The hovered feature gets `{ hover: true }` feature-state, the previous one is unset, and state is released on mouseleave, `detachEvents`, and `destroy`, so nothing stays lit.

  **Paint is rewritten so the state is visible.** Feature-state alone changes nothing on screen, so the layer's primary colour (`circle-color`, `line-color`, `fill-color`, `fill-extrusion-color`, `text-color`) is wrapped in a `case` on `["feature-state", "hover"]`. Only a plain literal colour is rewritten: an authored expression is left untouched and warned about, since overwriting it would silently discard data-driven styling. Layer types with no per-feature colour warn that highlight does not apply.

  **Sources without ids opt into generated ids.** Feature-state is addressed by feature id, so a geojson source with neither `generateId` nor `promoteId` has `generateId` enabled with a warning noting that generated ids are not stable across data refreshes and that `promoteId` is the durable choice.

  The interaction registry introduced for `click.flyTo` grows to carry state: an interaction now builds a per-`EventHandler` runtime, so `highlight` owns its tracked-feature bookkeeping and its own cleanup instead of leaking either into the event handler. `popup` and `flyTo` are unchanged in behavior.

  Known caveat: feature-state is per source, so two layers sharing one source share highlight state — highlighting a feature in one can restyle it in the other if both use feature-state paint.

- 141d3f1: Publish the YAML contract as machine-readable JSON Schema and ship the agent- and editor-facing affordances built on top of it. The Zod schemas already carried rich `.describe()` annotations; this converts and publishes them so authors get in-editor autocomplete and validation for free, and agents get a stable contract to generate against.

  **core: emit per-block JSON Schema at build time.** A new build step (`scripts/emit-json-schema.ts`, run by `pnpm build` after `tsup`) converts the Zod source into draft-07 JSON Schema documents — `map.schema.json` (`MapBlockSchema`), `scrollytelling.schema.json`, `root.schema.json` (the `pages:` document), and `any.schema.json` (a `oneOf` over the three, mirroring the Phase-1 `safeParseAny` dispatcher). `root.schema.json` emitted cleanly (~157 KB pretty-printed; the recursive `MixedBlock` is handled by `$ref` reuse, not inlined), so nothing was deferred. Per decision D7 these are generate-on-build: `packages/core/schemas/*.json` is git-ignored and regenerated by CI/build, never committed. They ship in the npm package (added to `files`) and are importable via a new `"./schemas/json/*"` export (e.g. `@maplibre-yaml/core/schemas/json/map.schema.json`).

  Per decision D8 the emitted schemas describe the **strict** shape — enumerated object nodes get `additionalProperties: false` plus a `patternProperties: {"^x-": {}}` escape hatch, so editors flag typo'd keys while `x-*` extensions stay legal. The Zod `.passthrough()` objects (`MapConfigSchema`'s arbitrary MapLibre options and the source schemas) are kept permissive to match the runtime, so the JSON Schema never rejects what `mlym validate` accepts; they tighten automatically when the validation-ergonomics work flips passthrough to warn-on-unknown. JSON Schema is advisory authoring assistance — `mlym validate` (Zod) remains the source of truth, since `.refine()`/`.superRefine()` cross-field rules do not convert.

  **cli: new `mlym schema [map|scrollytelling|root|any]` command.** Prints the JSON Schema resolved from the _installed_ `@maplibre-yaml/core` package, guaranteeing it matches the version `mlym validate` enforces; `--out <file>` writes it (creating parent directories). This is the offline / air-gapped path and the natural hook for future migration tooling.

  **Editor integration (zero-install).** Every CLI scaffold template and every canonical config in the docs now carries a `# yaml-language-server: $schema=...` modeline as its first line, so opening one in any `yaml-language-server`-backed editor (VS Code's Red Hat YAML extension, Neovim, JetBrains) gives autocomplete, hover docs, and inline validation with no project setup. New docs pages cover the modeline convention, the VS Code `yaml.schemas` settings-block alternative, and the generate → `mlym validate -f json` → repair agent loop with its structured `{ path, message, line, column }` error contract.

  **Agent resources.** The docs build now generates stable schema URLs (`/schema/latest/<block>.schema.json` plus versioned `/schema/v<major.minor>/`) and `llms.txt` / `llms-full.txt` from the same sources as the human docs, so they can never go stale. The content states explicitly the three things agents got wrong: `<ml-map src>` expects a `type: map` block (not a `pages:` root document), popups use the tag-array DSL (with a complete example), and named sources are referenced by bare name.

  Guarding all of it: snapshot tests over the generated schemas (regenerate with `pnpm --filter @maplibre-yaml/core test -- -u`) and a round-trip converter-fidelity test that validates every docs config and CLI template against _both_ the Zod parser and the generated JSON Schema via `ajv`.

- 0a605d1: Make named sources first-class: live refresh, shared `updateData`, and `$ref` resolution in standalone blocks (schema-truthfulness U7).

  **Named sources now refresh.** `MapRenderer` used to call `map.addSource` directly for block-level `sources:`, which bypassed every piece of refresh machinery — a named source could declare `refresh:` and never poll — and leaked YAML-only keys (`refresh`, `cache`, `prefetchedData`, the legacy top-level refresh fields) straight into the spec MapLibre validates. Registration moves to `LayerManager`, which scrubs those keys and owns one pipeline per source id, reference-counted: two layers over one source poll once, removing one keeps it running, removing the last stops it. `data-loaded`/`data-error` still fire per referencing layer, so a consumer listening on its own layer sees what it always did.

  **`updateData` reaches named sources.** It resolved a hardcoded `<layerId>-source`, which does not exist for a layer over a named source — so the update silently did nothing. It now resolves through the layer→source map. Updating through one layer is visible to every layer sharing that source; that is documented behaviour, not an accident. `pauseRefresh`, `resumeRefresh`, `refreshNow`, and `disconnectStream` stay layer-keyed and resolve to the shared pipeline, so callers never need to know which source shape they configured.

  **`$ref` sources resolve in standalone blocks.** `{$ref: "#/sources/x"}` in a `type: map` block — the flagship `<ml-map src>` path — survived parsing untouched, so the renderer saw a source with no `type` and silently added nothing: a config that validated and drew no layer. Standalone blocks now resolve refs against their own `sources:` record. Nested recursive `$ref` remains out of scope.

- 141d3f1: Add the `raster-dem` source type (schema-truthfulness U6). `hillshade` has always been a valid layer type, but there was no valid source to feed it — the elevation-tile source MapLibre requires was missing from the union, so a hillshade map could not be expressed at all.

  `RasterDEMSourceSchema` mirrors the raster source (url-or-tiles requirement, `tileSize`, zoom/bounds/attribution) plus `encoding: terrarium | mapbox | custom`, defaulting to `mapbox` to match MapLibre. Custom encodings carry `redFactor`/`greenFactor`/`blueFactor`/`baseShift` through passthrough. Map-level 3D `terrain:` configuration remains out of scope; this covers hillshade sourcing only.

  Registered everywhere the source union fans out: `LayerSourceSchema`, `markOpenSchema`, `SOURCE_TYPES`, and a `raster-dem` branch in `LayerManager.addSource`. Because `SOURCE_TYPES` grew, the "Unknown source type" message now reads `geojson, vector, raster, raster-dem, image, video`, and did-you-mean resolves `raster-dme` to `raster-dem`. Emitted JSON Schemas gain the new union member; snapshots updated deliberately alongside the behavior change.

  The docs gain a Raster DEM section with a complete hillshade map example, plus a `hillshade-demo.yaml` config fixture that is validated against both the Zod parser and the emitted JSON Schema.

  **Also fixes tile URL templates in the published JSON Schema.** Tile arrays were typed `z.string().url()`, which emitted `format: "uri"` — and `{z}/{x}/{y}` placeholders are not legal URI characters, so every standard XYZ tile template was reported invalid by editors and by agents generating configs, including the templates in our own documentation. The parser had always accepted them, making this a schema-vs-runtime disagreement of exactly the kind this release is closing. `tiles` entries now validate as URLs with placeholders substituted, and emit as plain strings. Affects `vector`, `raster`, and `raster-dem`.

- ff94d4f: Bring the published contract in line with what the renderer now does (schema-truthfulness U10).

  **Deprecated fields are annotated.** The emitted JSON Schemas mark `click.action`, `mouseenter.action`, `mouseleave.action`, and the legacy top-level `refreshInterval`/`updateStrategy`/`updateKey` with `deprecated: true`, driven by the same constants the runtime validator uses so the two cannot drift. Editors grey these out and agents generating configs can avoid them — until now nothing in the published contract distinguished a field that works from one that is accepted and does nothing.

  **The interactivity docs described the opposite of reality.** The page stated that "the schema doesn't explicitly define event handlers (as they're runtime JavaScript)" and showed readers how to hand-author `feature-state` paint expressions "when implemented in the runtime renderer". The schema has always defined `interactive.click.popup` and `hover.cursor`, and this release added `click.flyTo` and `hover.highlight` — which writes that paint expression for you. Rewritten to document the real `interactive:` block, including the id requirements `highlight` carries, the deprecated `action` fields and the events that replace them, and how to keep authoring your own highlight paint if you want the control.

  Also documents the `attribution` control's `compact` and `customAttribution` options, live refresh on a named source (one poll shared across referencing layers, and what `updateLayerData` does to siblings), and `$ref` source references.

- fda8aad: Validate the JSON-attribute and programmatic config paths (schema-truthfulness U9).

  `<ml-map>` validated configs that arrived as YAML — from an inline `<script>` or a `src` URL — but not those that arrived as an object. The `config` attribute and the programmatic `.config` setter went straight from `JSON.parse` to the renderer, so a well-formed object that failed the schema produced a broken map with no error card, no console warning, and no clue as to why. That is the same accepted-but-doesn't-work shape the rest of this release closes, on the entry paths least likely to be exercised in testing.

  Both now route through `YAMLParser.safeParseMapBlockValue`, so every entry point produces the same diagnostics: schema failures render the error card, unknown keys get did-you-mean suggestions, and deprecated fields warn. Positions are omitted for object input, since a line number would refer to text the caller never wrote.

  One consequence worth noting: **schema defaults now apply on these paths**, as they always have on YAML. A `legend:` supplied via the `config` attribute comes back with `collapsed: false` filled in. The two entry points previously produced different configs from identical input; they no longer do.

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

- f012d2c: Clear `hover.highlight` when a layer's data is replaced.

  Feature-state is keyed by feature id and survives `setData`, but ids are only meaningful within a single dataset — MapLibre's generated ids in particular are reassigned on every load. A highlight id retained across a refresh therefore lit up whichever feature happened to inherit that id, which is a different feature.

  Both paths that replace data now drop the tracked highlight first: the polling/stream refresh, and the public `updateLayerData`. The next pointer movement re-applies the highlight under the cursor.

## 0.3.1

### Patch Changes

- 67b7451: Minify the browser/CDN bundle. `register.browser.js` (served raw from unpkg for the zero-build `<script type="module">` path) was shipping unminified; the tsup browser pass now runs with `minify: true`, substantially shrinking the payload with no API or behavior change.

## 0.3.0

### Minor Changes

- 8511427: The CLI now validates and previews every block type it scaffolds, and preview renders with the locally installed core instead of a stale CDN pin.

  **core: new `YAMLParser.safeParseAny(yaml)` block dispatcher (also exported as `safeParseAny`).** Core exposed `safeParseMapBlock` / `safeParseScrollytellingBlock` / `safeParse` but no "detect `type:` and validate" entry point, so every consumer had to guess which schema a document needed. `safeParseAny` dispatches on the document's top-level `type:` field (`map` → MapBlockSchema, `scrollytelling` → ScrollytellingBlockSchema, no `type:` but `pages:` → RootSchema) and returns a discriminated `{ blockType, result }`. An unrecognized `type:` produces a clear error listing the valid values instead of a cryptic literal mismatch. Never throws.

  **cli: `validate` accepts everything `init` scaffolds.** `mlym validate story.yaml` on the CLI's own story template (`type: scrollytelling`) failed with a type-literal error because the validator called `safeParseMapBlock` unconditionally; root `pages:` documents were equally unsupported. Both now validate via `safeParseAny`. Exit-code semantics are unchanged.

  **cli: `preview` serves the locally installed core.** The preview page's import map hardcoded `https://esm.sh/@maplibre-yaml/core@0.1.2/dist/register.js` — preview rendered with a core two minors behind the one that validated the config. Preview now resolves the installed `@maplibre-yaml/core` and serves its browser register bundle through the dev server; only if local resolution fails does it fall back to esm.sh pinned to the _installed_ version read from the package's own package.json. Previewing a non-map document (e.g. the story template) now shows "visual preview currently supports only `type: map` blocks" instead of a misleading validation error, and the error overlay reflects the latest reload instead of the first load.

  **cli: SARIF output reports the real CLI version.** `--format sarif` hardcoded `version: '0.1.0'`; it now reads the version from the CLI's package.json like the `--version` flag does.

  **cli: astro template accuracy.** The template is described as what it is — an Astro project rendering the `<ml-map>` web component — its `@maplibre-yaml/core` dependency is pinned to `^0.2.0` instead of `latest`, and `init` next-steps text now matches what each template actually supports.

### Patch Changes

- ab8ba89: The documented CDN path now actually loads in a plain browser, and maplibre-gl v5 support is real.

  **Top-level `register.js` now re-exports `dist/register.browser.js`.** The unpkg shim previously pointed at the Node build, whose bare `import "yaml"` / `import "zod"` specifiers a plain `<script type="module">` cannot resolve — the documented CDN quick start was a guaranteed console error. It now points at the browser build (yaml + zod inlined), whose only bare specifier is `maplibre-gl`, provided by the import map in the updated docs snippets. The browser build is also compiled with `platform: "browser"` now: it previously bundled yaml's Node CJS entry, which threw `Dynamic require of "process" is not supported` the moment a browser loaded it. A `"./register.browser"` export was added to `package.json` for explicit access, and `verify-alpha-publish.sh` now fetches the served module (following the shim's re-export) and fails if any bare specifier other than `maplibre-gl` appears, so reachable-but-unresolvable can't ship again.

  **maplibre-gl v5 named-export compatibility, for real this time.** `MapRenderer`, `EventHandler`, and `ControlsManager` used the default-export namespace (`maplibregl.Map`, `maplibregl.Popup`, `maplibregl.NavigationControl`, ...) despite the peer range advertising `^5.0.0` and the 0.2.1 changelog claiming named imports had landed. They now consume named exports (`Map`, `Popup`, `NavigationControl`, `GeolocateControl`, `ScaleControl`, `FullscreenControl`) through a small interop module (`src/renderer/maplibre-interop.ts`) that resolves the constructors from `default ?? namespace` at runtime. The interop exists because maplibre-gl ships a CJS bundle whose named exports Node's cjs-module-lexer cannot detect — direct named imports crash every Node ESM consumer (the CLI's `validate`, Astro's content loader), which is what forced the previous revert. With the interop, the package works against maplibre-gl v4 and v5, in Node, bundlers, and browser import maps alike, making the documented `^3.0.0 || ^4.0.0 || ^5.0.0` peer range honest.

- 4ed6c5e: `controls:` and `legend:` blocks now render in `<ml-map>`; missing `mapStyle` shows a helpful error instead of a MapLibre crash.

  **`controls:` and `legend:` actually render.** `MapRenderer` constructed `ControlsManager`/`LegendBuilder` but never invoked them, and `<ml-map>` dropped both keys when extracting the parsed block — so YAML that validated cleanly rendered nothing. `<ml-map>` now threads `controls` and `legend` through to `MapRenderer`, which applies them on map `load` (the same lifecycle point layers use). The legend renders into a positioned `.ml-map-legend` container inside the map element. Manual `addControls()`/`buildLegend()` calls still work and are guarded against double-application.

  **Missing `mapStyle` gets a friendly error card.** `mapStyle` is schema-optional because the Astro builders resolve it from `globalConfig.defaultMapStyle`, but a standalone `<ml-map>` has no global config — an omitted `mapStyle` passed validation and died inside MapLibre with an opaque runtime error. `<ml-map>` now surfaces the existing error card stating that `mapStyle` is required for standalone maps, with a copy-pasteable example and a note that `defaultMapStyle` inheritance is an Astro-builder feature.

- 1daaee2: Two fixes for documented usage patterns that were broken:

  **Reject path-like strings in GeoJSON `source.data` with an actionable error.** Closes #32.

  Writing `data: "./src/data/foo.geojson"` in a map YAML schema-validated fine but failed silently in deployed sites — MapLibre treats string `data` as a URL, and `src/` isn't served at runtime by Astro / most static frameworks, so layers 404 and the map renders only its basemap. The schema now rejects strings starting with `./`, `../`, `src/`, or `/src/` in `data:` at parse time with a message that recommends the working pattern: move the file to `public/` and use `data: "/data/<filename>.geojson"`. Inline GeoJSON objects in `data:` and remote URLs in `data:` continue working unchanged.

  Note: the message recommends `data:` (not `url:`) intentionally — `url:` is currently schema-validated with `z.string().url()`, which requires a fully-qualified URL and rejects root-relative paths like `/data/foo.geojson`. Until that's relaxed in a future release, `data: "/path"` is the working pattern for files served from `public/`. A round-trip test (the rejection message recommends a pattern that itself validates) guards against this kind of dead-end going forward.

  **Add `register.js` at the package root so the documented unpkg URL works.** Closes #33.

  Our published docs (vanilla-js, web-components, quick-start integration guides) recommend:

  ```html
  <script
    type="module"
    src="https://unpkg.com/@maplibre-yaml/core/register"
  ></script>
  ```

  This URL returned 404 with no CORS headers because unpkg doesn't honor the package.json `exports` field for subpath resolution — it serves files at the literal path, and our `./register` export mapped to `./dist/register.js`. A thin top-level `register.js` re-exports `./dist/register.js` so the bare CDN URL now resolves with proper CORS. npm / Vite / Webpack consumers continue using the `exports`-field mapping and never touch this file.

  After 0.2.3 ships, no doc changes are required — every documented `<script src="https://unpkg.com/@maplibre-yaml/core/register">` snippet starts working.

- 291f852: Internal cleanup in core: removed the dead legacy refresh path and fixed abort-signal handling in the data fetcher.
  - **`LayerManager`**: deleted the superseded legacy refresh implementation (`refreshIntervals` map, the never-populated `abortControllers` map, and `startRefreshInterval` / `stopRefreshInterval` / `clearAllIntervals`). Polling is handled by `PollingManager`, which `addLayer` wires up automatically; the legacy `refreshInterval` YAML field keeps working through that path. Only the dead code is gone — no schema fields changed.
  - **`DataFetcher`**: `options.signal` is now honored correctly. The internal per-request controller (which also carries the timeout) aborts immediately if the caller's signal is already aborted, aborts (with the caller's reason) when the caller's signal fires, and the abort listener is removed from the external signal once the request settles so long-lived signals don't accumulate listeners across retries. Previously the code contained a no-op ternary (`options.signal ? new AbortController() : new AbortController()`) and never handled pre-aborted signals or listener cleanup.

- d87a7c5: Global config inheritance now actually flows into built map configs.

  **Astro map builders respect `globalConfig.defaultZoom`.** All six builders (`buildPointMapConfig`, `buildMultiPointMapConfig`, `buildPolygonMapConfig`, `buildRouteMapConfig`, `buildMultiPolygonMapConfig`, `buildMultiLineStringMapConfig`) previously hardcoded a zoom fallback (`zoom ?? location.zoom ?? 12`, or a literal `10`/`12`) that fired _before_ `resolveMapConfig` could apply the global default — so setting `defaultZoom` in your global config had no effect on built maps. Zoom now resolves as: explicit option > `location.zoom` (point builder) > `globalConfig.defaultZoom` > builder default. Behavior without a global config is unchanged: the builders' built-in defaults (12 for point/polygon, 10 for bounds-fitted builders) still apply as the last resort, so no existing call site starts throwing. `defaultCenter` and `defaultMapStyle` inheritance continue to be handled by core's `resolveMapConfig`, with explicit values always winning.

  **Core `resolveMapConfig` no longer uses an unsafe `as MapConfig` cast.** The return value is now structurally verified by TypeScript via narrowed locals after the missing-fields guard, so if a new required field is ever added to `MapConfig`, the resolver fails to compile instead of silently passing invalid data. Runtime behavior (resolution precedence, `ConfigResolutionError` on missing `mapStyle`/`center`/`zoom`) is unchanged.

- f716577: README corrections: fix the core JavaScript API example to use `YAMLParser.parseMapBlock` and the real `MapRenderer` constructor signature (`container, config, layers, options, sources`), replace the fictional `interactions:`/HTML-string popup format with the actual `interactive.click.popup` tag-array DSL, and fix the astro README scrollytelling example to use flat chapter `center`/`zoom` (matching `ChapterSchema`) instead of a nested `location:` object. Source `url` examples now use absolute URLs, which is what the schema validates.

## 0.2.2

### Patch Changes

- a053545: Revert the named-import change from 0.2.1 and update tests

  ### Bug fixes
  - **`@maplibre-yaml/core`**: reverted `map-renderer`, `controls-manager`, and `event-handler` from named `maplibre-gl` imports back to the default `maplibregl` import (e.g. `new maplibregl.Map(...)`), because the named-import build broke existing consumers. The maplibre-gl v5 peer range widening from 0.2.1 remains in place.
  - Updated the renderer, component, and integration tests to match the reverted import style.

## 0.2.1

### Patch Changes

- c24084a: Fix maplibre-gl v5 compatibility and peer dependency ranges

  ### Bug fixes
  - **`@maplibre-yaml/core`**: replaced default imports of `maplibre-gl` with named imports in `map-renderer`, `controls-manager`, and `event-handler`. maplibre-gl v5 removed the default export, which caused `SyntaxError: The requested module 'maplibre-gl' does not provide an export named 'default'` for consumers on v5. Named imports work for both v4 and v5.
  - **`@maplibre-yaml/core`**: widened `maplibre-gl` peer range from `^3.0.0 || ^4.0.0` to `^3.0.0 || ^4.0.0 || ^5.0.0`.
  - **`@maplibre-yaml/astro`**: peer dependency on `@maplibre-yaml/core` was pinned to the exact version `0.1.3-beta.1` because of `workspace:*` resolution at publish time. Changed to `workspace:^` so it resolves to a caret range (`^0.2.0`) and accepts current and future minor versions of core.
  - **`@maplibre-yaml/astro`**: widened `maplibre-gl` peer range from `^4.0.0` to `^4.0.0 || ^5.0.0`.

  These changes resolve `ERESOLVE` errors, `unmet peer dependency` warnings, and the `register.js` syntax error for projects using maplibre-gl v5.

## 0.2.0

### Minor Changes

- 937738a: Add block-level named sources to MapBlockSchema and MapFullPageBlockSchema

  ### New Feature: Named Sources

  Sources can now be defined at the map block level and referenced by string ID across multiple layers, rather than being inlined on each layer. This enables source reuse and cleaner YAML when multiple layers share the same data.

  ```yaml
  sources:
    boundary:
      type: geojson
      url: "/data/boundary.geojson"
  layers:
    - id: boundary-fill
      type: fill
      source: boundary # string reference
    - id: boundary-outline
      type: line
      source: boundary # same source, different layer
  ```

  - Added optional `sources` field to `MapBlockSchema` and `MapFullPageBlockSchema`
  - `MapRenderer` now accepts named sources and adds them to the map before processing layers
  - `LayerManager` correctly resolves string source references and avoids removing shared sources when individual layers are removed
  - Inline sources on layers continue to work as before — the two approaches can be mixed

## 0.1.0

### Minor Changes

- e7e1126: "add docs"
