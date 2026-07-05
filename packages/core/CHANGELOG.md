# @maplibre-yaml/core

## 0.3.0-alpha.0

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
