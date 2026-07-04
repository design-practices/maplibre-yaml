# fix: Shipped-but-Broken — Make Every Promise True

**Phase:** 1 of the [meta-plan](./meta-plan-stabilization-and-roadmap.md)
**Status:** Approved — in progress
**Priority:** P1 — precedes all feature work

## Overview

The 2026-07-04 assessment found six areas where released, documented behavior does not work. This plan fixes all of them. Each workstream is independently shippable; suggested order is A → E → B → C/D → F → G (user-facing severity first). Everything here is a patch or minor release under current semver.

## Problem Statement

Users following our own docs hit: silently non-functional global defaults, a CDN path that cannot resolve in a browser, YAML keys that validate but render nothing, a CLI whose scaffold's advertised next step errors, and first-touch READMEs teaching APIs that don't exist. Each is individually small; together they undermine the product's core claim — that declaring something in YAML makes it happen.

## Workstream A — Global config inheritance actually inherits (todos 001, 002)

**Problem.** `plans/feat-global-config-inheritance.md` shipped on paper, but:
- `packages/astro/src/utils/map-builders.ts:263` (and `:465`) hardcode `zoom ?? location.zoom ?? 12`, so `globalConfig.defaultZoom` can never win for point/polygon maps. A test asserts the wrong behavior (`expect(...zoom).toBe(12)`).
- `packages/core/src/utils/config-resolver.ts:132` still returns `resolved as MapConfig` — the unsafe cast the plan promised to eliminate (todo `001`, P1).

**Fix.**
1. In each builder, drop the hardcoded fallback and delegate zoom/center/style resolution to `resolveMapConfig(partial, globalConfig)` — the precedence logic already exists and is tested; the builders just bypass it. Where no globalConfig is passed and no explicit zoom exists, keep the current literal default (`12`) *inside the resolver call site* so behavior without globals is unchanged.
2. Update the test that enshrines non-inheritance to assert inheritance; add cross-cases (explicit beats global; global beats nothing; missing-everything throws `ConfigResolutionError` per the original plan).
3. Replace the `as MapConfig` cast with a return type derived from the overload narrowing (or a final `MapConfigSchema.parse(resolved)` if narrowing can't be expressed) and close todo `001`.

**Acceptance.** `defaultZoom`/`defaultCenter`/`defaultMapStyle` from `maps.yaml` demonstrably flow into a built map config in a test using `buildPointMapConfig` and `buildPolygonMapConfig`; todos `001` and `002` closed with work-log entries.

## Workstream B — CDN/unpkg path loads in a plain browser

**Problem.** `packages/core/register.js` re-exports `./dist/register.js` — the Node build with bare `import 'yaml' / 'zod' / 'maplibre-gl'` — which a `<script type="module">` cannot resolve. The CDN-ready `dist/register.browser.js` (yaml+zod bundled, 537 KB) is built (`tsup.config.ts:26-43`) but referenced by nothing. Even the browser build bare-imports `maplibre-gl`. `scripts/verify-alpha-publish.sh` checks HTTP 200 + CORS, which is why this passed: reachable ≠ resolvable.

**Fix.**
1. Point `register.js` at `./dist/register.browser.js` and add a `"./register.browser"` export in `package.json` for explicitness.
2. For `maplibre-gl`: keep it external (double-bundling a ~800 KB peer is worse) and make the documented CDN snippet use an **import map**:
   ```html
   <script type="importmap">
     {"imports": {"maplibre-gl": "https://esm.sh/maplibre-gl@^4"}}
   </script>
   <script type="module" src="https://unpkg.com/@maplibre-yaml/core/register.js"></script>
   ```
   Update `README.md`, `packages/core/README.md`, and `getting-started/installation.mdx` quick-start snippets accordingly.
3. Harden `verify-alpha-publish.sh`: after the 200/CORS check, fetch the module text and assert it contains **no bare specifiers other than `maplibre-gl`** (grep for `from "yaml"` / `from "zod"`). Optionally add a Playwright smoke test loading the snippet from a static file.
4. While in this area: `map-renderer.ts:6`, `event-handler.ts:6`, `controls-manager.ts:6` still use `import maplibregl, {...}` default imports despite CHANGELOG 0.2.1 claiming they were replaced with named imports (maplibre-gl v5 removed the default export, and our peer range advertises `^5.0.0`). Convert to named imports for real, and add a CI job that installs maplibre-gl@5 and runs the test suite against it.

**Acceptance.** A static HTML file using only the documented CDN snippet renders a map in headless Chromium; verify script fails if a bare `yaml`/`zod` import ever reappears; test suite passes against maplibre-gl v4 and v5.

## Workstream C — `controls:` and `legend:` render

**Problem.** `MapRenderer` constructs `ControlsManager`/`LegendBuilder` but never calls `addControls()`/`buildLegend()` (`map-renderer.ts:166-175` are manual-only methods), and `ml-map.renderMap` extracts only `{config, sources, layers}` (`ml-map.ts:304`), dropping `controls`/`legend` from the parsed block.

**Fix (per meta-plan decision D2 — make it work, don't remove it).**
1. Pass `controls` and `legend` through `ml-map.renderMap` into the renderer.
2. In `MapRenderer`, invoke `addControls()` on map `load` when a controls config is present; same for `buildLegend()`.
3. Note: the Astro `FullPageMap` component has its own hand-rolled zoom/reset controls (`FullPageMap.astro:274-333`) and a heuristic legend (`:343-390`). Do **not** unify in this phase — just add a code comment cross-referencing the duplication; consolidation is tracked in the perf/hygiene backlog.

**Acceptance.** A YAML config with `controls: { navigation: true }` and a `legend:` block shows both in the rendered `<ml-map>`; integration test asserts the DOM contains the control/legend containers.

## Workstream D — the `mapStyle` dead-end

**Problem.** `mapStyle` is schema-optional ("when global `defaultMapStyle` is set", `map.schema.ts:249-255`) but `<ml-map>` has no global-config source, so an omitted `mapStyle` passes validation and dies inside MapLibre with an opaque error (`ml-map.ts:304-319` → `map-renderer.ts:59-68`).

**Fix.** In the `<ml-map>` path (standalone block, no global config available), treat missing `mapStyle` as a render-time validation error and surface it in the existing error card with the same quality bar as the parser's messages: state that `mapStyle` is required for standalone maps, show a copy-pasteable example, and mention `defaultMapStyle` inheritance is an Astro-builder feature. Do not change the schema (Astro builders legitimately omit it).

**Acceptance.** `<ml-map>` with a style-less config shows the friendly error card, not a MapLibre stack trace; test added.

## Workstream E — CLI validates and previews what it scaffolds

**Problem.**
- `validator.ts:49` and `preview/server.ts:38` call `YAMLParser.safeParseMapBlock` unconditionally. `mlym validate story.yaml` on the CLI's own story template (`type: scrollytelling`) fails with a type-literal error, and `init.ts:122` tells story users to run exactly that broken preview command. Root `pages:` documents are equally unsupported.
- `preview/server.ts:75` hardcodes `https://esm.sh/@maplibre-yaml/core@0.1.2/dist/register.js` — preview renders with a core two minors behind the one being validated.
- `validate.ts:21` hardcodes `version = '0.1.0'` in SARIF output (real version: 0.1.12).
- The `astro` template's `package.json.template` doesn't include `@maplibre-yaml/astro` and its next-steps text is misleading (`init.ts:118-120`).

**Fix.**
1. Add a **block dispatcher to core** (this is the root cause — core exposes `safeParseMapBlock` / `safeParseScrollytellingBlock` / `safeParse` but no "detect `type:` and validate" entry point): `YAMLParser.safeParseAny(yaml)` returning `{ blockType: 'map' | 'scrollytelling' | 'root', result }`, with an unknown-`type` error that lists valid values. Use it in CLI `validate` and `preview`.
2. Preview: serve the **locally installed** core. Resolve `require.resolve('@maplibre-yaml/core/register')` (or the browser build from Workstream B) and serve it through Vite instead of the esm.sh pin; fall back to esm.sh pinned to the *installed* version only if local resolution fails. For non-map blocks, preview should at minimum render the validation state rather than a parse error; scrollytelling visual preview can be a follow-up, but the error must say "preview does not yet support scrollytelling" instead of "invalid literal".
3. Read the SARIF tool version from the CLI's own `package.json` (the lazy read in `cli.ts:19` already does this — reuse it).
4. Fix the astro template to either depend on `@maplibre-yaml/astro` and demo `<Map />`, or rename/describe it as "astro + web component" and correct the next-steps text.

**Acceptance.** `mlym init story && mlym validate story.yaml && mlym preview story.yaml` works end-to-end; preview loads the same core version that validated; SARIF reports the true version; `mlym validate` on a `pages:` root doc validates it.

## Workstream F — first-touch docs corrections

Fix the specific mismatches the docs audit found (all verified against code):

| Location | Problem | Fix |
|---|---|---|
| `docs/.../getting-started/installation.mdx:72` | imports non-existent `@maplibre-yaml/core/web-components` | `.../register` |
| `installation.mdx:54,90-114` | uses non-exported `parseYAML`, treats result as MapBlock | `safeParseMapBlock` via `YAMLParser`; correct result shape |
| `packages/core/README.md:41-63` | `parseYAMLConfig` on a bare `type: map` doc (requires `pages:`), wrong `MapRenderer` ctor arity | use `parseMapBlock` + correct 5-arg ctor, or the `safeParseAny` from Workstream E |
| `packages/core/README.md:209-215` | `interactions:` plural + HTML-string + `{{ }}` popup format that never existed | canonical `interactive.click.popup` tag-array DSL |
| `docs/patterns/collections-posts-with-maps.md:125-134,251-258` | third popup variant (`tag:`/`content:`/`{title}`) | canonical format |
| `docs/patterns/collections-posts-with-maps.md:823` | stale domain `maplibre-yaml.design-practices.com` | `docs.maplibre-yaml.org` |
| `packages/astro/README.md:626-639` | scrollytelling chapters nest `location: {center, zoom}`; `ChapterSchema` is flat | flat `center`/`zoom` (CLI story template is already correct) |
| `docs/.../schema/root.mdx:134,228` | string `source: "#/sources/x"` — resolver only handles `$ref` objects or bare names | bare-name form, with a note on `$ref` objects |
| `docs/astro.config.mjs:44` | sidebar links `guides/styling/` — page doesn't exist | remove link (writing the guide belongs to Phase 3) |
| `docs/astro.config.mjs:77-79` | autogenerated `api/` section — directory doesn't exist | remove section until an API reference exists |
| `docs/.../guides/collections-integration.mdx:355` | "recommended approach for v0.1.0" | version-neutral wording |

Also add the missing-height warning to `first-map.mdx` (it never shows the host element), and state explicitly in `web-components.mdx` that `<ml-map src>` expects a `type: map` block, not a `pages:` root document.

**Acceptance.** Every import path and YAML snippet in the touched files round-trips: imports resolve against built packages, YAML snippets pass `mlym validate`. Add a docs-CI script that extracts fenced `yaml` blocks from these files and validates them, so this class of drift can't recur silently.

## Workstream G — repo hygiene (cheap, do alongside)

- Remove the committed `.history/` directory and add it to `.gitignore`.
- `examples/astro/otf`: fix `"name": "minimal"` copy-paste, switch `link:` deps to `workspace:*`, delete the stale nested `pnpm-lock.yaml` (it resolves to 0.1.x betas), reinstall clean.
- CI: the "lint" job runs no linter — either add one (eslint or biome) or rename the job; wire `scripts/check-publish.sh` into `release.yml` so the 0.2.0 `workspace:` guard is enforced, not manual; align release workflow Node version with the tested matrix or add Node 22 to the matrix.
- Add the missing 0.2.2 entry to core's CHANGELOG.
- Delete the dead legacy refresh path in `LayerManager` (`refreshIntervals`, never-populated `abortControllers`, `startRefreshInterval` et al., `layer-manager.ts:54-71,442-503`) — superseded by `PollingManager`. (The legacy *schema fields* stay until the deprecation policy exists; only the dead code goes.)
- `data-fetcher.ts:351-353`: both branches of the signal ternary are identical — honor a caller-provided signal or drop the parameter.

## Testing strategy

- Every workstream lands with a regression test that fails on today's code.
- New E2E layer (Playwright, headless Chromium): CDN snippet renders (B), controls/legend appear (C), error card on missing style (D). These are the first tests that exercise real `maplibre-gl` instead of mocks — the current `ml-map` test mocks both MapLibre and MapRenderer, which is how D shipped unnoticed.
- Docs snippet validation script (F) runs in CI.

## Out of scope

- Core-rendered scrollytelling (meta-plan D3 — docs will state it's Astro-delivered).
- Strict/unknown-key validation, line/column errors → [feat-validation-ergonomics.md](./feat-validation-ergonomics.md).
- JSON Schema, llms.txt → [feat-json-schema-and-agent-affordances.md](./feat-json-schema-and-agent-affordances.md).
- Lazy loading, request dedupe, teardown aborts → [perf-bundle-and-lazy-loading.md](./perf-bundle-and-lazy-loading.md).
- New positioning/comparison docs pages → [docs-positioning-and-examples.md](./docs-positioning-and-examples.md).
