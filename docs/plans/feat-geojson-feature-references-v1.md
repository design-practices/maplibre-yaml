# feat: GeoJSON feature references for Astro collections (V1)

> **Deepened: 2026-05-06** -- Added Key Technical Decisions, Open Questions, dependency-ordered Implementation Units, Performance Budget, and expanded Risks based on parallel review by repo-research-analyst, pattern-recognition-specialist, architecture-strategist, and performance-oracle.
>
> **Implementation learnings (2026-05-07)** added below in "Implementation Notes" section.

## Overview

Today, collection items in `@maplibre-yaml/astro` carry their geometry inline in frontmatter (`coordinates`, `region.coordinates`, `route.coordinates`). For projects with a single source-of-truth GeoJSON file (e.g., the OTF site's eventual `gowanus.geojson` covering all parcels, parks, and infrastructure), this forces authors to copy coordinates into every markdown file -- error-prone, hard to update, and visually noisy.

V1 introduces a `feature_ref` field that lets a collection item point at a single feature in an external GeoJSON file (matched by `id` or by a single property/value pair). At build time, a new async builder reads the file, finds the feature, detects its geometry type, and dispatches to the existing point/polygon/route builders.

## Problem Statement

**Current pain point**: an author who has a GeoJSON file with all relevant geometry has no way to use it from a collection item. They must either:
1. Copy/paste coordinates into each markdown file (duplication, drift)
2. Hand-write loader code per page (boilerplate, no validation)
3. Inline the entire GeoJSON FeatureCollection per item (huge frontmatter)

**Real-world driver**: in the OTF example, 57 POAs reference geometry that all lives within the Gowanus rezoning area. Many will share parcels, buildings, or zones. Maintaining inline coordinates across 57 files is unsustainable -- a small geometry correction would mean 57 edits.

## Proposed Solution

Add a `FeatureRefSchema` and an async `buildFeatureMapConfig` builder that:

1. Accepts a path to a GeoJSON file plus a match criterion (`featureId` or `match: { property, equals }`)
2. Reads and caches the file at build time (cached by absolute path)
3. Resolves the matching feature exactly once, then builds an in-memory index for subsequent lookups
4. Detects the feature's geometry type (Point, LineString, Polygon, MultiPolygon, MultiPoint)
5. Dispatches to the existing sync builders (`buildPointMapConfig`, `buildPolygonMapConfig`, `buildRouteMapConfig`, `buildMultiPointMapConfig`)
6. Returns a `MapBlock` ready to pass to `<Map config={...} />`

### Frontmatter shape

```yaml
# By feature.id (when the GeoJSON has top-level id fields)
feature_ref:
  source: "./src/data/gowanus.geojson"
  featureId: "poa-1.1"

# By property equality (more common in real-world GeoJSON)
feature_ref:
  source: "./src/data/gowanus.geojson"
  match:
    property: "gotf_id"
    equals: 1.1

# Optional metadata overrides (fall back to feature.properties otherwise)
feature_ref:
  source: "./src/data/gowanus.geojson"
  featureId: "library-487"
  name: "New Library Branch"           # overrides feature.properties.name
  description: "Public library construction"
  zoom: 16
  markerColor: "#e74c3c"
```

### Page usage

```astro
---
import { Map, buildFeatureMapConfig } from "@maplibre-yaml/astro";
import { globalMapConfig } from "../../lib/map-config";

const { entry } = Astro.props;
const data = entry.data;

let mapConfig;
if (data.feature_ref) {
  mapConfig = await buildFeatureMapConfig({ ref: data.feature_ref }, globalMapConfig);
} else if (data.region) {
  // existing logic
}
// ... rest of dispatch
---
<Map config={mapConfig} height="300px" />
```

## Technical Considerations

### Architecture

Three new pieces, all in `packages/astro/src/utils/`:

1. **`feature-ref-schema.ts`** -- `FeatureRefSchema` (Zod), inferred type `FeatureRef`
2. **`feature-ref-loader.ts`** -- file reading, parsing, caching, feature lookup
3. **`feature-ref-builder.ts`** -- async builder that orchestrates loader + existing sync builders

### Schema design (Zod discriminated union)

```typescript
// Match by feature.id
const MatchByIdSchema = z.object({
  featureId: z.union([z.string(), z.number()]),
});

// Match by property equality
const MatchByPropertySchema = z.object({
  match: z.object({
    property: z.string(),
    equals: z.union([z.string(), z.number(), z.boolean()]),
  }),
});

const FeatureRefSchema = z.object({
  source: z.string().describe("Path to GeoJSON file (project-root-relative or absolute)"),
  // Display overrides (fall back to feature.properties)
  name: z.string().optional(),
  description: z.string().optional(),
  zoom: z.number().min(0).max(24).optional(),
  // Style overrides
  markerColor: z.string().optional(),
  fillColor: z.string().optional(),
  strokeColor: z.string().optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
  color: z.string().optional(),
  width: z.number().positive().optional(),
})
  .and(z.union([MatchByIdSchema, MatchByPropertySchema]))
  .refine(
    (data) => "featureId" in data || "match" in data,
    { message: "Must provide either 'featureId' or 'match'" }
  );
```

Real-world data shows GeoJSON `id` is often missing (RFC 7946 spec marks it optional, and tools like Tippecanoe added `--use-attribute-for-id` precisely because of this). Property matching is the dominant pattern, mirroring MapLibre's `promoteId`.

### File loading & caching (mtime-aware)

```typescript
// feature-ref-loader.ts
import { readFile, stat } from "fs/promises";
import { resolve } from "path";

interface CacheEntry {
  mtimeMs: number;
  fc: FeatureCollection;
  // Lazy per-property index; populated on second access for that property
  indexByProperty: Map<string, Map<unknown, Feature>>;
}

const fileCache = new Map<string, CacheEntry>();

async function loadFeatureFile(srcPath: string): Promise<FeatureCollection> {
  const absPath = resolve(process.cwd(), srcPath);
  const { mtimeMs } = await stat(absPath);                  // throws ENOENT with clear message

  const cached = fileCache.get(absPath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.fc;  // unchanged: cache hit

  const content = await readFile(absPath, "utf-8");
  const parsed = JSON.parse(content);                          // throws SyntaxError with file path
  validateGeoJSON(parsed);                                     // throws GeoJSONLoadError with details

  fileCache.set(absPath, { mtimeMs, fc: parsed, indexByProperty: new Map() });
  return parsed;
}

/** Test-only: clear cache between test files. */
export function clearFeatureCache(): void {
  fileCache.clear();
}
```

The cache lives at module scope but invalidates on file mtime change. This means:

- `astro build` (one-shot): cache populated once, hit on every subsequent reference -- 50 POAs sharing one file = 1 parse, 49 cache hits
- `astro dev` (long-running): editing the GeoJSON file updates its mtime, the next page render re-parses transparently. No dev-server restart needed.
- Tests that share absolute paths get a `clearFeatureCache()` API to ensure isolation

The `stat` syscall is microseconds and runs on every call, but parsing only re-runs when mtime changes. Net: HMR limitation is retired with ~5 lines of code.

**Index strategy**: features are not indexed eagerly. On the first lookup against a property, build `Map<value, Feature>` for that property and cache it on the entry. Subsequent lookups against the same property are O(1). This amortizes when 2+ items match by the same property (the common case). If features count is < ~200, the linear scan is fast enough that index-build overhead isn't worth it -- skip indexing for small files.

### Geometry dispatch

```typescript
function dispatchByGeometry(feature: Feature, ref: FeatureRef, globalConfig?: GlobalConfig): MapBlock {
  const geom = feature.geometry;
  const props = feature.properties ?? {};
  const name = ref.name ?? props.name;
  const description = ref.description ?? props.description;

  switch (geom.type) {
    case "Point":
      return buildPointMapConfig(
        { location: { coordinates: geom.coordinates, name, description, zoom: ref.zoom, markerColor: ref.markerColor } },
        globalConfig,
      );
    case "MultiPoint":
      return buildMultiPointMapConfig(
        { locations: geom.coordinates.map((c) => ({ coordinates: c, name, description, markerColor: ref.markerColor })) },
        globalConfig,
      );
    case "LineString":
      return buildRouteMapConfig(
        { route: { coordinates: geom.coordinates, name, description, color: ref.color, width: ref.width } },
        globalConfig,
      );
    case "Polygon":
      return buildPolygonMapConfig(
        { region: { coordinates: geom.coordinates, name, description, fillColor: ref.fillColor, strokeColor: ref.strokeColor, fillOpacity: ref.fillOpacity } },
        globalConfig,
      );
    case "MultiPolygon":
      // Use first polygon ring set; document the limitation
      return buildPolygonMapConfig(
        { region: { coordinates: geom.coordinates[0], /* ... */ } },
        globalConfig,
      );
    default:
      throw new GeoJSONLoadError(
        `Unsupported geometry type "${geom.type}" in feature ref. ` +
        `V1 supports: Point, MultiPoint, LineString, Polygon, MultiPolygon. ` +
        `Open an issue if you need MultiLineString or GeometryCollection.`,
        ref.source,
      );
  }
}
```

### Error handling

New error class `GeoJSONLoadError` modeled on `YAMLLoadError`:

| Failure mode | Error message |
|---|---|
| File not found | `Cannot find GeoJSON file: {absPath}. Path is resolved from project root ({cwd}).` |
| Invalid JSON | `GeoJSON file {path} contains invalid JSON: {error}` |
| Not a FeatureCollection | `Expected GeoJSON FeatureCollection at {path}, got {actualType}` |
| Feature not found (by id) | `No feature with id "{featureId}" found in {path}. File contains {N} features. First IDs: {first3}` |
| Feature not found (by prop) | `No feature where {property} === {value} in {path}. {N} features checked.` |
| Multiple matches | `Match returned {N} features ({first3 ids/values}). V1 requires exactly one. Use a more specific match criterion.` |
| Unsupported geometry | (see dispatch above) |

### HMR / watch-mode behavior

The mtime-aware cache (above) handles GeoJSON file edits transparently: saving the file updates its mtime, and the next page render re-parses. **No dev-server restart required.**

What's still missing in V1: `fs.readFile` doesn't participate in Vite's module graph, so editing the GeoJSON file does not automatically trigger a re-render of pages that reference it. The user has to navigate or refresh after saving. Full Vite HMR integration via plugin or `import.meta.glob` is deferred to V2.

### Path resolution

User-supplied `source` is resolved via `path.resolve(process.cwd(), source)`. In Astro this means project-root-relative, matching the existing convention from `loadGlobalMapConfig('./src/config/maps.yaml')`. Absolute paths also work. Document this clearly.

### Top-level await compatibility

The builder is async, which means callers must `await` it. The OTF example's `[poas].astro` already supports this (frontmatter top-level await is documented Astro behavior). No new caveats.

## Key Technical Decisions

These design forks were considered explicitly. Recording the chosen path plus the rejected alternative for each so reviewers can validate the reasoning.

### Decision 1: Async convenience builder + lower-level sync primitives

**Chosen:** `buildFeatureMapConfig` is a single async call that loads, finds, and dispatches. ALSO export `loadFeatureFile` (async) and `findFeature` (sync) as primitives.

**Rejected:** Force users to call the loader and a sync resolver separately.

**Why:** The convenience builder is the right default for the OTF use case (one POA = one map = one call). But the asymmetry with the existing 4 sync builders is real -- if a power user wants to load a file once and dispatch many features sync, exporting the primitives gives them that escape hatch without duplicating internals. Both shapes share the same cache, so no redundant parsing.

```typescript
// Common case: convenience
const config = await buildFeatureMapConfig({ ref }, globalConfig);

// Power case: shared file across many lookups
const fc = await loadFeatureFile(ref.source);
const feature = findFeature(fc, ref);
const config = buildPolygonMapConfig({ region: { coordinates: feature.geometry.coordinates, ... } }, globalConfig);
```

### Decision 2: Separate `feature_ref` field, not a union into existing schemas

**Chosen:** `feature_ref` is a new optional field on collection schemas alongside `location`, `region`, `route`.

**Rejected:** Extend each existing schema via `z.union([inline, ref])` so users keep using `location:` for both inline and ref forms.

**Why:** The ref is geometry-type-agnostic at authoring time (the user often doesn't know if `gotf_id: 1.1` resolves to a Point or Polygon until build runs). Folding a shape-agnostic ref into per-shape schemas is a category error and produces confusing Zod error messages. Separate field is purely additive (existing collections work unchanged) and the dispatch chain growing from 4 → 5 branches is acceptable.

**Precedence rule when both present:** If a collection item declares `feature_ref` AND any of `location`/`region`/`route`, the schema validation rejects with a clear error. We do NOT silently prefer one over the other -- ambiguity in frontmatter should be a build error. (Acceptance criterion below.)

### Decision 3: New `GeoJSONLoadError` class, with optional shared base for V2

**Chosen:** New `GeoJSONLoadError` class modeled on `YAMLLoadError`. V1 ships them as siblings.

**Considered:** Add a shared `MaplibreYamlLoadError` abstract base now so consumers can `catch` either type via the base.

**Why kept simple in V1:** `GeoJSONLoadError` failure modes (feature-not-found, multi-match, unsupported geometry) don't map neatly onto `YAMLLoadError`'s `ParseError[]` shape. Forcing a shared base now risks bloating the shared shape. We can introduce a base class later as an additive change without breaking existing `instanceof YAMLLoadError` checks. Document the V2 consideration in Open Questions.

### Decision 4: mtime-aware cache (changed from naive cache)

**Chosen:** `Map<absPath, { mtimeMs, fc, indexByProperty }>` with `fs.stat` mtime check on every load.

**Rejected:** Naive `Map<absPath, FeatureCollection>` with no invalidation (the original V1 sketch).

**Why:** Naive cache made `astro dev` actively hostile to authoring -- editing the GeoJSON file required restarting the dev server, which defeats the purpose of iterating on geometry. mtime check costs microseconds per call and removes the documented limitation entirely. See "File loading & caching (mtime-aware)" above.

### Decision 5: Build-time only with explicit runtime guard

**Chosen:** Build-time only execution. Add a runtime-environment guard that throws an actionable error if `buildFeatureMapConfig` is invoked in a deployed SSR adapter context where `process.cwd()` won't contain the source file.

**Rejected:** Silent failure when called at runtime (the original V1 sketch left this implicit).

**Why:** Astro projects mix static and SSR routes freely. There's no compile-time check preventing `buildFeatureMapConfig` from running inside an SSR `getStaticPaths` or even at request time. A defensive runtime guard ("Feature refs are build-time only; resolve at build via getStaticPaths or inline the resolved config") prevents silent failures in production. Cheap to implement: detect SSR context via `import.meta.env.SSR === true && !import.meta.env.PROD === false` or similar Astro-specific signals.

## Open Questions

### Resolved during planning

- **Should `feature_ref` and inline `location`/`region`/`route` be allowed to coexist on the same item?** No. Schema rejects coexistence with a clear error (Decision 2 precedence rule).
- **Where do `loadFeatureFile` and `findFeature` live in the export hierarchy?** Both exported from `@maplibre-yaml/astro` and `@maplibre-yaml/astro/utils`, alongside `buildFeatureMapConfig`. Documented in README as "lower-level primitives for power users."
- **Should the cache key include cwd?** No. `path.resolve(process.cwd(), src)` produces the absolute path, which already encodes cwd. Two callers passing equivalent-but-textually-different paths share the parse.

### Deferred to implementation

- **Should the `match.equals` value accept arrays as a shorthand for "in"?** e.g., `match: { property: "category", equals: ["library", "park"] }`. Decision deferred until V1 implementation -- low cost to add but expands the schema surface. Recommend gathering V1 feedback first.
- **Is `match.*` shape reserved for future expansion?** Currently `{ property, equals }` only. Future shapes could include `{ all: [...] }`, `{ any: [...] }`, `{ property, in: [...] }`. V1 should document that `match.*` keys other than `property` and `equals` are reserved for future use, so we can extend without breaking changes.
- **Should we strip unused feature properties before serialization?** A `gowanus.geojson` feature might carry 15+ properties when the rendered MapBlock only needs 2-3. Stripping unused properties would reduce serialized HTML size. Detection requires recursive scanning of popup content blocks and paint/layout expressions for `["get", "X"]` references. Risky because users may attach JS event handlers reading properties at runtime. **Deferred to V2** as opt-in `propertiesAllow: string[]` field. Document as known V2 candidate.

## Acceptance Criteria

### Functional

- [ ] `FeatureRefSchema` exported from both `packages/astro/src/index.ts` and `packages/astro/src/utils/index.ts`
- [ ] `FeatureRef` type exported in dedicated `export type {}` block
- [ ] `buildFeatureMapConfig({ ref }, globalConfig?)` returns a `Promise<MapBlock>`
- [ ] `loadFeatureFile(src)` and `findFeature(fc, ref)` also exported as lower-level primitives
- [ ] `clearFeatureCache()` exported for test isolation
- [ ] Schema accepts both `featureId` and `match` shapes; rejects neither/both
- [ ] `getCollectionItemWithFeatureRefSchema(customFields?)` exported as the canonical collection-helper that enforces mutual exclusivity of `feature_ref` with inline `location`/`region`/`route`
- [ ] Cross-field validation rejects coexistence at content-collection-parse time with a clear error message naming the conflicting fields
- [ ] Builder reads file via `fs.readFile`, resolves path via `process.cwd()`
- [ ] Builder uses mtime-aware cache: re-parses when file mtime changes, hits cache when unchanged
- [ ] Builder builds a per-property index lazily on second access for that property (skipped if features.length < 200)
- [ ] Geometry dispatch supports: `Point`, `MultiPoint`, `LineString`, `Polygon`, `MultiPolygon`
- [ ] Geometry dispatch throws clear error for: `MultiLineString`, `GeometryCollection`
- [ ] Frontmatter `name`/`description` override `feature.properties.name`/`properties.description`
- [ ] Style overrides (`markerColor`, `fillColor`, etc.) flow through to underlying builder
- [ ] Runtime-environment guard: builder throws actionable error if invoked in a deployed SSR adapter context (cwd doesn't contain the source file)

### Error handling

- [ ] `GeoJSONLoadError` class exported, with `errors`, `filePath`, `hint` fields
- [ ] File-not-found error includes resolved absolute path and cwd
- [ ] Feature-not-found error includes file path, total feature count, and sample of available IDs/values
- [ ] Multi-match error names the count and first 2-3 matched values; suggests narrowing
- [ ] Invalid JSON error includes file path and inner parser message
- [ ] All errors include `hint:` field with a remediation suggestion (mirroring AstroError style)

### Tests

- [ ] Unit tests for `FeatureRefSchema` validation (valid id form, valid property form, missing both, both at once)
- [ ] Unit tests for file loader: cache hit/miss, file not found, invalid JSON
- [ ] Unit tests for feature lookup: by id (string + number), by property (string/number/boolean values), 0 matches, 1 match, N matches
- [ ] Unit tests for geometry dispatch: each supported type produces correct `MapBlock` shape
- [ ] Unit test confirming style overrides flow through to underlying builders
- [ ] Test fixtures: at least one GeoJSON file with mixed geometry types under `packages/astro/tests/fixtures/`
- [ ] Tests follow existing pattern: real fs in tmpdir with `${Date.now()}` isolation

### Documentation

- [ ] `packages/astro/README.md` -- new "GeoJSON Feature References" section between "Adding Geographic Data..." and "Important Notes"
- [ ] `docs/src/content/docs/integrations/astro.mdx` -- new section after "Adding Geographic Data to Content Collections"
- [ ] JSDoc on every exported symbol, matching the density of existing `map-builders.ts` entries (`@param`, `@returns`, `@throws`, `@remarks`, `@example`)
- [ ] Document the HMR limitation explicitly
- [ ] Document the build-time-only constraint explicitly

### Integration

- [ ] OTF example updated: dispatch chain in `examples/astro/otf/src/pages/poas/[poas].astro` adds a `feature_ref` branch (before existing geometry branches)
- [ ] OTF content schema updated: `feature_ref: FeatureRefSchema.optional()` added to POA collection
- [ ] One or two POA markdown files in OTF migrated from inline coords to feature_ref form (as a working demo)
- [ ] Sample `gowanus.geojson` fixture added to `examples/astro/otf/src/data/`

## Success Metrics

- A POA with `feature_ref` renders the correct map (visual smoke test)
- Build time for OTF site does not regress more than 5% (50 POAs reading from same GeoJSON should hit cache 49 times)
- Error messages identified during dev (file not found, missing feature) are actionable on first read -- no need to consult docs
- Migration from inline `region.coordinates` to `feature_ref` reduces a POA's frontmatter line count by at least 10 lines for typical polygons

## Performance Budget

Documented file size guidance for V1. Files outside these bounds either warn or hard-error so users get clear feedback rather than silent OOM:

| File size | Behavior | Notes |
|---|---|---|
| < 10MB | Fully supported, no caveats | Negligible memory cost (~30MB peak heap), parse < 100ms |
| 10MB-50MB | Supported with one-time parse cost noted in JSDoc | Up to ~2s parse, ~500MB peak heap. Comfortable on 8GB runners. |
| 50MB-100MB | Build-time warning emitted ("consider splitting or PMTiles") | Up to ~5s parse, ~1GB peak. Tight on 4GB runners. |
| > 100MB | Hard error (`GeoJSONLoadError`) with guidance toward PMTiles, vector tiles, or file splitting | Prevents silent CI OOM. |

**Per-build performance targets:**
- Parse + validate + index for a 50MB file with 50k features: < 3s
- Cached lookup for a single feature: < 1ms
- Per-property index build (lazy, first access on a property): < 100ms for 50k features
- 200 collection items × 1 shared file: file parsed once, lookups complete in aggregate < 500ms

**When to recommend alternatives:** If a project exceeds these budgets repeatedly, the right tool is no longer V1's in-memory loader. Document a follow-up path:

- Geometry larger than ~100MB → PMTiles via `pmtiles` source type (V2 candidate)
- Filtering needs beyond `match.equals` → DuckDB Spatial or Tippecanoe pre-processing
- Real-time data → already handled by core's GeoJSON source `refresh`/`stream`, not a feature-ref concern

## Dependencies & Risks

### Dependencies

- No new external dependencies (uses Node `fs/promises`, existing `zod`, existing core builders)
- Requires `@maplibre-yaml/astro` minor bump (additive feature: `0.1.3 → 0.2.0`)

### Risks

| Risk | Mitigation |
|---|---|
| `JSON.parse` peak heap is 5-10x file size; OOM on small CI runners | Hard error above 100MB; warn above 50MB; document 4GB-runner ceiling. See Performance Budget. |
| Property-match becomes O(n) per item with many items referencing the same file | Build per-property index lazily on second access for that property; eager for files with <200 features. Documented in cache strategy. |
| Module-level cache survives across test files (state leak) | Export `clearFeatureCache()` for test isolation. Test convention: call in `afterEach` when sharing absolute paths. |
| Unbounded cache growth in long-running `astro dev` sessions | Acceptable in V1 (1-3 GeoJSON files typical); revisit if reported in practice. mtime-check ensures correctness, not memory bound. |
| Unintended client-bundle inclusion of `fs/promises` | Add bundle-output assertion test confirming no `fs` references in client build. |
| Async builder vs sync existing builders (5-builder API asymmetry) | Document the asymmetry; export sync primitives (`loadFeatureFile`/`findFeature`) as escape hatch. |
| Multi-feature use cases (one POA → 3 parcels) deferred to V2 | Document V2 roadmap explicitly. Multi-match still throws clear error in V1. |
| GeoJSON without `id` fields breaks the `featureId` shorthand | Property match form covers this; document `match: { property, equals }` as the more universal pattern (Tippecanoe/promoteId precedent). |
| Deployed SSR adapter contexts (Vercel, Cloudflare) will fail silently if builder runs at request time | Runtime-environment guard throws actionable error directing users to `getStaticPaths` or inline configs. |
| GeoJSON file edits during `astro dev` require manual page refresh | mtime cache invalidates correctly on edit, but Vite doesn't trigger HMR for files outside the module graph. Documented as known V1 limitation; V2 may add Vite plugin. |

## Implementation Notes (post-build)

Two adjustments made during implementation that the plan did not anticipate:

### 1. `FeatureRefSchema` is a plain `ZodObject`, not `ZodEffects`

Originally I implemented `FeatureRefSchema` as `z.object({...}).superRefine(...)` to enforce the `featureId` XOR `match` constraint at parse time. This produced a `ZodEffects` wrapping a `ZodObject`. When users referenced `FeatureRefSchema.optional()` in their Astro 5 content collection schemas, the dev server failed with:

```
[content] Content config not loaded
[ERROR] Cannot read properties of undefined (reading 'get')
```

Astro 5's content layer is incompatible with `ZodEffects.optional()` in some flow paths. Refactor:

- `FeatureRefSchema` is now a plain `ZodObject` (no `.superRefine`)
- The XOR check moved to a new exported helper, `assertValidFeatureRef(ref)`
- `buildFeatureMapConfig` calls `assertValidFeatureRef` automatically before loading the file
- Tests for "rejects neither" / "rejects both" moved from schema tests to builder tests
- Schema-level tests now confirm the bare schema accepts both invalid forms (XOR is enforced at build time)

This is a behavior change vs the plan's spec, but functionally equivalent: invalid refs still produce clear errors, just at build time rather than content-collection-parse time. Advanced consumers who want parse-time enforcement can call `assertValidFeatureRef` in their own `.superRefine()`.

### 2. Content configs must import from `@maplibre-yaml/astro/utils`, not the main barrel

The package's main entry (`@maplibre-yaml/astro`) re-exports both Astro components (`Map`, `FullPageMap`, `Scrollytelling`) and utility functions. When `src/content/config.ts` imports from the main entry, Astro's content layer (running in a Node context) tries to evaluate the `.astro` component files and fails -- producing the same `Cannot read properties of undefined (reading 'get')` error.

The fix is to import schemas from the `@maplibre-yaml/astro/utils` subpath (which already exists in `package.json` exports). This subpath includes all schemas, builders, loaders, and helpers but excludes the Astro components. Astro pages (`.astro` files) continue to import components from the main entry.

This guidance was added to:

- `packages/astro/README.md` -- new "Two import paths" section near the top, plus updates to all `src/content/config.ts` code examples
- `docs/src/content/docs/integrations/astro.mdx` -- Aside callouts at relevant content-config examples
- The changeset for this release

Existing content-config examples in the docs that imported from `@maplibre-yaml/astro` were updated to use `@maplibre-yaml/astro/utils`. This is technically a documentation change, not a code change -- the `/utils` subpath has always existed -- but it's now the recommended path for content configs.

## Forward Compatibility (V1 → V2)

V1 ships intentionally narrow, but the V2 candidate list is the long-term goal. This section audits each V1 decision against the V2 candidate list to confirm V1 doesn't paint future implementations into a corner. **The implementer must honor these constraints** — they are V2-enabling guardrails, not just notes.

### Forward-compatibility constraints on V1 implementation

These are concrete instructions the implementer must follow to keep V2 doors open:

1. **Match schema must NOT use `.strict()`** — the schema must accept (and ignore) future-reserved keys like `all`, `any`, `in`, `filter`. Use the default Zod behavior (extra keys passthrough) or explicit `.passthrough()`. If V1 uses `.strict()`, adding compound match shapes in V2 becomes a breaking change.

2. **Runtime guard must be skippable via internal opt-out** — Decision 5's runtime-environment guard prevents misuse in deployed SSR contexts. But V2's runtime resolution candidate needs a way to legitimately bypass it. Implementation detail: the guard checks an internal flag (e.g., `INTERNAL_ALLOW_RUNTIME` constant exported from the module), so V2 can add a `buildFeatureMapConfigRuntime` variant that opts out without re-checking the entire guard logic. Document this as a private extension point — not exposed in the public API.

3. **Test instrumentation hooks must be private** — Unit 3's `getCacheEntryDebug` (or `__lookupCount` counter) is for tests only. Do NOT export it from `packages/astro/src/index.ts` or `packages/astro/src/utils/index.ts`. Use `@internal` JSDoc tag and a name with `_` prefix or `Debug` suffix to signal non-public status. This prevents V2 from being tied to a specific instrumentation surface.

4. **`GeoJSONLoadError` should accept an optional `cause` field** — Decision 3 keeps the class shape simple. But V2's shared `MaplibreYamlLoadError` base class will likely add `cause` (the standard ES2022 Error pattern). Including it in V1 (`new GeoJSONLoadError(msg, filePath, errors, { cause: originalError })`) costs nothing and means the V2 base class introduction stays purely additive.

5. **`feature_ref` field name should not preclude `feature_refs` (plural)** — Decision 2 uses singular field for V1's single-feature-ref scope. V2's multi-feature support would add `feature_refs` (plural) as a separate field. The collection-helper schema factory (`getCollectionItemWithFeatureRefSchema`) should be authored so adding a `feature_refs` field later doesn't require changing its name (e.g., consider `getCollectionItemWithFeatureSchema` as a forward-looking name that accommodates both — implementer's call, but think about it).

6. **Cache implementation must be module-private** — Decision 4's `Map<absPath, CacheEntry>` cache lives at module scope and is not exported. V2's runtime resolution candidate may need a different cache implementation (e.g., HTTP cache via fetch). Keep V1's filesystem cache fully encapsulated so V2 can swap or supplement it without breaking changes.

7. **Builder return type stays `Promise<MapBlock>`** — Decision 1's async signature must not be changed to accept callbacks, observers, or streaming patterns in V2. If V2 needs progressive resolution, it should be a new builder, not a signature change.

### Auditing each V2 candidate against V1 decisions

| V2 candidate | V1 risk | Mitigation in V1 |
|---|---|---|
| Multi-feature refs (`feature_refs` plural) | Field name lock-in | Constraint #5 above. New plural field is purely additive. |
| Compound match shapes (`all`/`any`/`in`) | Schema closure via `.strict()` | Constraint #1: do not use `.strict()` on match schema. |
| Mapbox-style filter expressions | Could conflict with `match` semantics | Add as a new top-level `filter` key (not under `match`); independent of V1 match shape. |
| Property stripping (`propertiesAllow`) | None | V1 includes all properties; stripping layers on top as additive opt-in. |
| Runtime resolution | Decision 5 runtime guard blocks legitimate use | Constraint #2: guard is opt-out via internal flag. |
| Vite HMR integration | Decision 4 cache competes with Vite tracking | Constraint #6: cache is private; HMR can supplement. |
| MultiLineString / GeometryCollection | Currently throws | Adding handler cases is non-breaking. |
| Shared error base class (`MaplibreYamlLoadError`) | Decision 3 keeps siblings | Adding a parent is non-breaking; constraint #4 accepts `cause` for forward compat. |
| Schema mixin refactor | Decision 2 inlines style fields | User-facing types unchanged; refactor is internal. |
| `buildMapConfigFromEntry` helper | Dispatch chain in pages | New helper composes existing builders. |
| PMTiles source support | Out of scope for V1 | Independent feature. |

### V2 candidates that are NOT precluded by V1

All V2 candidates remain available. The 7 constraints above are the only V1 implementation choices needed to keep them open.

## Out of Scope (V2 candidates)

These are explicitly deferred to keep V1 shippable. Document each as a known limitation:

- **Multi-feature refs**: `match` returning >1 feature → multi-point or multi-polygon map
- **Mapbox-style filter expressions**: `filter: ["all", [">=", ["get", "year"], 2020], ...]`
- **Compound match shapes**: `match: { all: [...] }`, `{ any: [...] }`, `{ property, in: [...] }` (V1 reserves `match.*` keys for these without committing to the shape)
- **Property stripping for serialized output size**: opt-in `propertiesAllow: string[]` field on `FeatureRefSchema` that drops feature.properties not in the allow-list before serialization. Detection of "used" properties (popup expressions, paint expressions) is non-trivial; better as a future explicit opt-in than an automatic optimization. V1 keeps all properties.
- **Runtime resolution**: load GeoJSON via URL on the client
- **Vite HMR integration**: editing a GeoJSON file triggers automatic page re-render (V1 invalidates cache correctly but doesn't push HMR events)
- **Spatial queries**: "feature whose geometry contains point X"
- **`MultiLineString` and `GeometryCollection`** geometry types
- **Shared error base class**: `MaplibreYamlLoadError` abstract base that both `YAMLLoadError` and `GeoJSONLoadError` extend (purely additive when added later)
- **Schema mixin refactor**: extract shared `LabelOverridesSchema` / `PointStyleSchema` / `PolygonStyleSchema` / `LineStyleSchema` mixins to deduplicate styling fields across `LocationPointSchema`, `RegionPolygonSchema`, `RouteLineSchema`, and `FeatureRefSchema`. Drift risk grows with each new style field added.
- **`buildMapConfigFromEntry(entry, globalConfig)` helper**: absorb the geometry-type dispatch chain currently duplicated per page. Would reduce `[poas].astro` from 5 branches to 1 call.
- **PMTiles source support**: alternative to inline GeoJSON for very large geometry datasets

## Implementation Units

Six dependency-ordered units. Each can land as an atomic commit. Unit 5 may be merged into Unit 4 if the team prefers fewer commits; Unit 6 is the integration smoke test and depends on every prior unit.

### Unit 1: `FeatureRefSchema`, inferred type, and collection-helper schema

**Goal:** Land the Zod schema, `FeatureRef` type, AND a collection-helper factory `getCollectionItemWithFeatureRefSchema()` that adds the cross-field precedence rule (rejects coexistence of `feature_ref` with inline `location`/`region`/`route`). No runtime, no I/O.

**Dependencies:** None. First unit.

**Files:**
- Create: `packages/astro/src/utils/feature-ref-schema.ts`
- Create: `packages/astro/tests/utils/feature-ref-schema.test.ts`
- Modify: `packages/astro/src/utils/collections-schemas.ts` (add `getCollectionItemWithFeatureRefSchema(customFields?)` factory that composes `FeatureRefSchema.optional()` with `LocationPointSchema.optional()`, `RegionPolygonSchema.optional()`, `RouteLineSchema.optional()` plus a `.refine()` enforcing mutual exclusivity)
- Modify: `packages/astro/tests/utils/collections.test.ts` (add tests for the new factory)
- Modify: `packages/astro/src/utils/index.ts` (export schema, type, and factory)
- Modify: `packages/astro/src/index.ts` (mirror; type export in dedicated `export type {}` block at lines 86-90)

**Patterns to follow:**
- Schema shape, JSDoc density, `.describe()` use, type-export block: `packages/astro/src/utils/collections-schemas.ts:42-114` (`LocationPointSchema`, `RegionPolygonSchema`, `RouteLineSchema` triplet)
- Factory pattern (composition with optional `customFields`): `packages/astro/src/utils/collections-schemas.ts:168-371` (existing `getCollectionItemWith*Schema` factories — mirror exactly, including the `customFields?: z.ZodRawShape` extension parameter)
- Module-level file header (`@file`, `@module`, `@description`, `@example`): `packages/astro/src/utils/collections-schemas.ts:1-40`
- Export structure: `packages/astro/src/utils/index.ts:65-81` and `packages/astro/src/index.ts:74-90`

**Test scenarios for `FeatureRefSchema`:**
- Happy path: `parse({ source, featureId: "poa-1.1" })` → returns object with `featureId` as string
- Happy path: `parse({ source, featureId: 42 })` → returns object with `featureId` as number
- Happy path: `parse({ source, match: { property: "gotf_id", equals: 1.1 } })` → returns property-form object
- Happy path: `parse({ source, match: { property: "active", equals: true } })` → boolean equals accepted
- Error: `parse({ source })` (neither `featureId` nor `match`) → throws ZodError with hint to provide one
- Error: `parse({ source, featureId: "x", match: { property: "y", equals: 1 } })` → throws ZodError (both forms forbidden simultaneously)
- Error: `parse({ source, featureId: "x", zoom: 25 })` → throws ZodError (zoom > 24)
- Error: `parse({ source, featureId: "x", fillOpacity: 1.5 })` → throws ZodError (out of [0,1])
- Edge: `parse({ source, featureId: "x", name: "Override" })` → optional override fields accepted

**Test scenarios for `getCollectionItemWithFeatureRefSchema()`:**
- Happy path: parse item with only `feature_ref` set → succeeds
- Happy path: parse item with only `location` set → succeeds (backward compatible)
- Happy path: parse item with only `region` set → succeeds
- Happy path: parse item with no geometry fields set → succeeds (all are optional)
- Error: parse item with `feature_ref` AND `location` → throws ZodError naming both fields and explaining mutual exclusivity
- Error: parse item with `feature_ref` AND `region` → throws ZodError
- Error: parse item with `feature_ref` AND `route` → throws ZodError
- Error: parse item with all four fields → throws ZodError (only `feature_ref` violation reported, others implicit)
- Edge: factory called with `customFields` → resulting schema accepts custom fields alongside geometry fields

**Forward-compatibility constraints (Unit 1):**
- The `match` object schema must NOT use `.strict()`. Future V2 keys (`all`, `any`, `in`, `filter`) must pass through cleanly. Use Zod default (strip-unknown) or explicit `.passthrough()`. See Forward Compatibility constraint #1.
- Consider naming the collection-helper factory in a way that accommodates future plural-ref support (e.g., `getCollectionItemWithFeatureSchema` rather than `...FeatureRefSchema`). Implementer's discretion; document the decision in JSDoc.

**Verification outcomes:**
- `FeatureRefSchema`, the collection-helper factory, and `FeatureRef` type all importable from `@maplibre-yaml/astro` and `@maplibre-yaml/astro/utils`
- `FeatureRef` type in dedicated `export type {}` block
- `FeatureRefSchema` accepts both id-form and property-form frontmatter; rejects neither and both
- Numeric, string, and boolean `equals` values round-trip through the schema
- The collection-helper factory enforces mutual exclusivity at parse time, with error messages that name conflicting fields
- `match` schema accepts unknown future keys (forward-compatibility test: `parse({ source, match: { property: "x", equals: 1, futureKey: "ignored" } })` does not throw)

---

### Unit 2: `GeoJSONLoadError` class plus pure feature-lookup helper

**Goal:** Add the error class and the pure (non-I/O) `findFeature` predicate. Keeping the lookup predicate separate from file loading is what makes the loader testable in Unit 3 with synthetic in-memory FeatureCollections.

**Dependencies:** Unit 1 (`findFeature` accepts a `FeatureRef`-typed argument).

**Files:**
- Create: `packages/astro/src/utils/feature-ref-loader.ts` (only error class and `findFeature` in this unit; loader function added in Unit 3)
- Create: `packages/astro/tests/utils/feature-ref-loader.test.ts` (only `findFeature` and error-class tests in this unit)
- Modify: `packages/astro/src/utils/index.ts` (export `GeoJSONLoadError` and `findFeature`)
- Modify: `packages/astro/src/index.ts` (mirror)

**Patterns to follow:**
- Error class shape (`extends Error`, `name`, `filePath`, optional structured `errors` field, constructor signature): `packages/astro/src/utils/loader.ts:63-80` (`YAMLLoadError`)
- Class-level JSDoc with `@remarks` and `@example`: `packages/astro/src/utils/loader.ts:45-62`
- Export grouping: `packages/astro/src/utils/index.ts:48-54` (loader-utilities export block)

**Test scenarios:**
- Happy path: `findFeature(fc-with-3-features, { featureId: "poa-1.1" })` where one feature has `id: "poa-1.1"` → returns that feature
- Happy path: `findFeature(fc-with-numeric-ids, { featureId: 42 })` where one feature has `id: 42` → returns that feature (no string/number coercion)
- Happy path: `findFeature(fc, { match: { property: "gotf_id", equals: 1.1 } })` → returns matching feature
- Happy path: `findFeature(fc, { match: { property: "active", equals: true } })` → boolean equals matches
- Error: `findFeature(fc-with-no-matches, { featureId: "missing" })` → throws `GeoJSONLoadError` whose message names file path, lookup value, total feature count, and sample of available IDs
- Error: `findFeature(fc-with-3-matches, { match: ... })` → throws `GeoJSONLoadError` whose message names the count and at least the first 2 matched values, suggests narrowing
- Edge: `findFeature(fc-with-feature-missing-properties, { match: ... })` → safely skips features with `properties: null/undefined` (does not throw TypeError)
- Edge: `new GeoJSONLoadError(msg, "/abs/path", [...])` → instance has `name === "GeoJSONLoadError"`, `filePath`, structured details, and is `instanceof Error`

**Forward-compatibility constraints (Unit 2):**
- `GeoJSONLoadError` constructor must accept an optional ES2022 `cause` field: `new GeoJSONLoadError(msg, filePath, errors?, options?: { cause?: unknown })`. The `cause` is forwarded to the parent `Error.cause`. This costs nothing in V1 and keeps Decision 3's deferred shared-base-class introduction additive. See Forward Compatibility constraint #4.

**Verification outcomes:**
- `GeoJSONLoadError` is exported from both barrels and is `instanceof Error`
- `GeoJSONLoadError` accepts optional `{ cause }` field; `error.cause` is set when provided
- `findFeature` is exact-equality only (no type coercion across string/number)
- Not-found error message contains file path, count, and sampling of available identifiers (observable in `error.message`)
- Multi-match error message names the count and at least 2 matching values
- `findFeature` never reads from disk

---

### Unit 3: Async file loader with mtime-aware cache

**Goal:** Add `loadFeatureFile` -- the async function that reads a GeoJSON file, parses it, validates that it's a FeatureCollection, and caches by absolute path with mtime-based invalidation. This is the only unit that touches the filesystem.

**Dependencies:** Unit 2 (uses `GeoJSONLoadError`).

**Files:**
- Modify: `packages/astro/src/utils/feature-ref-loader.ts` (add `loadFeatureFile`, `clearFeatureCache`, module-scope cache)
- Modify: `packages/astro/tests/utils/feature-ref-loader.test.ts` (add `describe("loadFeatureFile", ...)` suite with tmpdir pattern)
- Modify: `packages/astro/src/utils/index.ts` (export `loadFeatureFile` and `clearFeatureCache`)
- Modify: `packages/astro/src/index.ts` (mirror)

**Patterns to follow:**
- Async file-read with try/wrap/throw and re-throw of own error class: `packages/astro/src/utils/loader.ts:126-171` (`loadYAML`)
- Test isolation pattern (tmpdir + `${Date.now()}`-suffixed dir, `beforeEach` create, `afterEach` `rm -rf`, `writeFile` per test): `packages/astro/tests/utils/loader.test.ts:19-31`
- Schema-validation error wrapping: `packages/astro/src/utils/loader.ts:145-156`

**Test scenarios:**
- Happy path: write valid FeatureCollection to tmpdir, call loader → returns parsed object whose `.features` length matches written length
- Cache: call loader twice on same path within one test, second call does not re-read (assert by reference equality OR by mutating the file content without changing mtime and confirming the in-memory result is unchanged)
- mtime invalidation: write file, load, mutate file with `utimes` to bump mtime, load again → returns fresh content (new reference)
- Cache key normalization: call loader with two different paths that resolve to the same absolute target → both return the same cached object
- Error: missing path → throws `GeoJSONLoadError` whose message contains the resolved absolute path and the cwd
- Error: malformed JSON → throws `GeoJSONLoadError` with file path and underlying parser message
- Error: file containing single Feature (not FeatureCollection) → throws `GeoJSONLoadError` naming the actual `type` value
- Error: file containing JSON array (not an object) → throws `GeoJSONLoadError`
- Test isolation: `clearFeatureCache()` empties the cache (verify by re-loading after a deletion confirms second load actually re-reads)
- Lazy index threshold (small file): load file with 50 features, two consecutive `findFeature` calls against same property → both linear-scan (no index built); observable via internal counter or `getCacheEntryDebug(absPath).indexByProperty.size === 0`
- Lazy index threshold (large file, first access): load file with 250 features, single `findFeature` against property "X" → linear scan; `indexByProperty.has("X") === false` afterward
- Lazy index threshold (large file, second access on same property): load file with 250 features, two consecutive `findFeature` calls against property "X" → second call uses index; `indexByProperty.has("X") === true` afterward AND comparison count drops measurably
- Lazy index threshold (large file, different property second time): two `findFeature` calls against different properties on a 250-feature file → both linear-scan; only the property hit twice would build an index (but neither was hit twice in this test, so no index built)

**Forward-compatibility constraints (Unit 3):**
- Cache map and any cache-management functions beyond `clearFeatureCache` must remain module-private (not exported from `index.ts`). V2 may swap or supplement the cache (e.g., for runtime resolution); a private cache is fully replaceable. See Forward Compatibility constraint #6.
- Test instrumentation (`getCacheEntryDebug` / `__lookupCount`) must be private. Use `@internal` JSDoc tag and a name with `_` prefix or `Debug` suffix. Do NOT export from `packages/astro/src/index.ts` or `packages/astro/src/utils/index.ts`. See Forward Compatibility constraint #3.

**Verification outcomes:**
- Loader resolves relative paths against `process.cwd()` (observable: error messages on missing files include the absolute resolved path)
- Cache key is the resolved absolute path, not the input string -- two callers passing equivalent-but-textually-different paths share the parse
- mtime change invalidates the cache; unchanged mtime hits the cache
- All four failure modes (missing, invalid JSON, wrong shape, unreadable) produce `GeoJSONLoadError` with a file path attached
- `clearFeatureCache()` is exported and forces fresh reads on the next call
- Cache implementation is module-private (not exported from `index.ts`); only `clearFeatureCache` is public
- Per-property index builds lazily on second access for that property when features.length >= 200; stays unbuilt below the threshold or after only one access. Test-only instrumentation hooks are marked `@internal` and not exported.

---

### Unit 4: Geometry dispatch and async builder orchestration

**Goal:** Land `buildFeatureMapConfig` -- the async builder that calls the loader, calls `findFeature`, then dispatches to the existing sync builders by geometry type and applies frontmatter overrides over `feature.properties`.

**Dependencies:** Units 1, 2, 3.

**Files:**
- Create: `packages/astro/src/utils/feature-ref-builder.ts`
- Create: `packages/astro/tests/utils/feature-ref-builder.test.ts`
- Modify: `packages/astro/src/utils/index.ts` (export `buildFeatureMapConfig` in the map-builder block)
- Modify: `packages/astro/src/index.ts` (mirror)

**Patterns to follow:**
- Builder signature shape and per-builder JSDoc (`@param`, `@returns`, `@remarks`, `@example`): `packages/astro/src/utils/map-builders.ts:242-314` (`buildPointMapConfig`). New builder is async but otherwise mirrors this signature exactly.
- Thin-wrapper-delegating-to-loader pattern: `packages/astro/src/utils/global-config.ts:30-35` (`loadGlobalMapConfig`)
- Override-falls-back-to-properties precedent: `examples/astro/otf/src/pages/poas/[poas].astro:63-77` (`region.name ?? poaLabel` fallback chain). Use `ref.name ?? props.name` analogously.

**Test scenarios:**
- Happy path: fixture with one Point feature, ref points by id → returns MapBlock whose layer-0 type is `circle` and `config.center` matches
- Happy path: Polygon feature → returns MapBlock with two layers (`fill` and `line`), matching `buildPolygonMapConfig` shape
- Happy path: LineString feature → returns MapBlock with line + endpoints layers, matching `buildRouteMapConfig` shape
- Happy path: MultiPoint feature → returns MapBlock matching `buildMultiPointMapConfig` shape
- Edge: MultiPolygon feature → returns MapBlock from polygon builder using the first polygon's rings; documented limitation
- Error: MultiLineString feature → throws `GeoJSONLoadError` whose message names the geometry type and file path
- Error: GeometryCollection → throws `GeoJSONLoadError`
- Override behavior: ref with `name: "Override"` and feature with `properties.name: "Original"` → popup contains "Override"
- Override behavior: ref without `name` and feature with `properties.name: "Original"` → popup contains "Original"
- Style flow: ref with `markerColor: "#ff0000"` against Point feature → marker color reaches the underlying point builder
- Style flow: ref with `fillColor` against Polygon feature → fill color reaches polygon builder
- Cache integration: builder called twice for two different refs against same source file → file is read once (assert via cache observability from Unit 3)
- globalConfig: builder called with a `globalConfig` argument → underlying sync builder receives the same `globalConfig` (observable in returned MapBlock's `config` defaults)
- Runtime guard: stub `process.cwd()` or env to simulate SSR adapter → builder throws actionable `GeoJSONLoadError` directing user to build-time resolution

**Forward-compatibility constraints (Unit 4):**
- Builder return type stays `Promise<MapBlock>`. Do NOT change the signature in V2 (e.g., to accept callbacks, observers, or streaming). New behaviors should be new builders. See Forward Compatibility constraint #7.
- Runtime-environment guard must be skippable via internal opt-out (not exposed in public API). Implement as a module-private constant or function flag (e.g., `const INTERNAL_ALLOW_RUNTIME = false` that V2's runtime variant can override internally). Document this as a private extension point in JSDoc with `@internal` tag. See Forward Compatibility constraint #2.

**Verification outcomes:**
- Each supported geometry type produces a MapBlock structurally equivalent to what the corresponding sync builder produces directly
- Frontmatter overrides win over `feature.properties` for `name`, `description`, and style fields; properties are the fallback
- Style overrides reach the underlying builder (not silently dropped)
- Unsupported geometry types and `GeometryCollection` throw `GeoJSONLoadError` with actionable messages
- `globalConfig` is forwarded unchanged to whichever sync builder is dispatched to
- Two refs targeting the same source file share a single file read (cache observable)
- Runtime guard logic is encapsulated and skippable via an internal flag (verifiable: V2 can implement a runtime variant that bypasses the guard without re-implementing the entire builder)

---

### Unit 5: Test fixture with mixed geometry types

**Goal:** Land a real, committed `sample.geojson` fixture used by Unit 4's tests. May be merged into Unit 4 if the team prefers fewer commits.

**Dependencies:** None directly. Should land alongside or just before Unit 4.

**Files:**
- Create: `packages/astro/tests/fixtures/sample.geojson`
- Modify: `packages/astro/tests/utils/feature-ref-builder.test.ts` (point fixtures at the new file)

**Patterns to follow:**
- No exact `tests/fixtures/` precedent in the astro package -- this unit establishes the convention. Map-builder tests at `packages/astro/tests/utils/map-builders.test.ts:18-60` inline simple TypeScript fixtures; GeoJSON FeatureCollections with five geometry types are large enough to warrant a real `.geojson` file.

**Test expectation: none -- this is a data file.** Verify by inspection:
- Fixture parses cleanly as JSON and as GeoJSON
- Contains exactly one feature per supported geometry type (Point, MultiPoint, LineString, Polygon, MultiPolygon)
- Contains one feature per unsupported type (MultiLineString, GeometryCollection) for error-path coverage
- Each feature has both `id` and `properties.gotf_id` so it can be matched both ways
- Includes one feature whose `properties` is null or missing (exercises Unit 2's null-properties test)
- Includes at least two features sharing the same `properties.gotf_id` (exercises Unit 2's multi-match path)

**Verification outcomes:**
- Unit 4 tests run against the committed fixture rather than inline JSON
- The fixture covers every dispatch branch in Unit 4

---

### Unit 6: OTF example integration (end-to-end smoke test)

**Goal:** Update the OTF example to consume the new builder. This is the last unit because it depends on every prior unit and serves as the end-to-end smoke test.

**Dependencies:** Units 1, 4 (everything observable downstream of the schema and the builder).

**Files:**
- Modify: `examples/astro/otf/src/content/config.ts` (use `getCollectionItemWithFeatureRefSchema()` factory or add `feature_ref: FeatureRefSchema.optional()` plus a `.refine()` for mutual exclusivity — pick whichever is simpler given the existing schema shape). **Important:** import schemas from `@maplibre-yaml/astro/utils` (NOT `@maplibre-yaml/astro`) -- see Implementation Notes section above.
- Modify: `examples/astro/otf/src/pages/poas/[poas].astro` (insert `feature_ref` branch first in dispatch chain at lines 61-91; that branch must `await buildFeatureMapConfig`)
- Create: `examples/astro/otf/src/data/gowanus.geojson` (sample file)
- Modify: at least one POA markdown file under `examples/astro/otf/src/content/poas/` to use `feature_ref` instead of inline coordinates

**Patterns to follow:**
- Existing dispatch chain to extend: `examples/astro/otf/src/pages/poas/[poas].astro:61-91`. New branch goes first (highest precedence) and uses `await`. Match the inline-comment density of lines 57 and 79.
- POA collection-schema location: mirror the existing `region`/`route`/`location` `.optional()` convention
- `globalMapConfig` import + use precedent: same file (line 38 area)

**Test scenarios:** Integration verification, not unit testing:
- `pnpm --filter astro-otf-example build` succeeds
- Migrated POA page renders a map (visual check; no test runner)
- OTF site's build wall-clock does not regress >5% (success metric)
- Removing `feature_ref` from a migrated POA falls back to existing `region`/`route`/`location` branches without error
- Pointing `feature_ref.source` at a missing file produces a build-time `GeoJSONLoadError` whose message identifies the file path

**Verification outcomes:**
- Migrated POA page renders the correct geometry on the live OTF dev server
- Build-time errors from this branch surface with file paths and feature identifiers
- Frontmatter line count for the migrated POA drops by at least 10 lines for typical polygons (success metric)
- Editing the GeoJSON file in dev mode and refreshing renders updated geometry without a server restart (mtime cache verification)

---

### Documentation (deferred to a separate commit, can land alongside Unit 6)

Not blocking any unit. Update docs as a single consolidated pass:

- Modify: `packages/astro/README.md` (new "GeoJSON Feature References" section between "Adding Geographic Data..." and "Important Notes")
- Modify: `docs/src/content/docs/integrations/astro.mdx` (new section after collection-item docs)
- Create: `.changeset/feat-feature-refs.md` (minor bump for `@maplibre-yaml/astro`: `0.1.3 → 0.2.0`)

## Pseudocode: builder

```typescript
// feature-ref-builder.ts
export async function buildFeatureMapConfig(
  options: { ref: FeatureRef },
  globalConfig?: GlobalConfig,
): Promise<MapBlock> {
  const { ref } = options;
  const featureCollection = await loadFeatureFile(ref.source);
  const feature = findFeature(featureCollection, ref);
  return dispatchByGeometry(feature, ref, globalConfig);
}

// feature-ref-loader.ts
export async function loadFeatureFile(src: string): Promise<FeatureCollection> {
  const abs = resolve(process.cwd(), src);
  if (fileCache.has(abs)) return fileCache.get(abs)!;
  // ...read, parse, validate, cache
}

export function findFeature(fc: FeatureCollection, ref: FeatureRef): Feature {
  const matches = "featureId" in ref
    ? fc.features.filter((f) => f.id === ref.featureId)
    : fc.features.filter((f) => f.properties?.[ref.match.property] === ref.match.equals);

  if (matches.length === 0) throw new GeoJSONLoadError(/* not found */);
  if (matches.length > 1) throw new GeoJSONLoadError(/* multiple */);
  return matches[0];
}
```

## Mermaid: data flow

```mermaid
flowchart TD
    A[Markdown frontmatter<br/>feature_ref: ...] --> B[Astro content collection<br/>parses with FeatureRefSchema]
    B --> C[[poas].astro page]
    C --> D{await buildFeatureMapConfig}
    D --> E[loadFeatureFile<br/>cache by absPath]
    E --> F[Parsed FeatureCollection]
    F --> G[findFeature<br/>by id or property]
    G --> H{Geometry type?}
    H -->|Point| I[buildPointMapConfig]
    H -->|Polygon| J[buildPolygonMapConfig]
    H -->|LineString| K[buildRouteMapConfig]
    H -->|MultiPoint| L[buildMultiPointMapConfig]
    H -->|other| M[GeoJSONLoadError]
    I --> N[MapBlock]
    J --> N
    K --> N
    L --> N
    N --> O[<Map config={...} />]
```

## References & Research

### Internal

- Existing builders: `packages/astro/src/utils/map-builders.ts:242-663` (canonical builder structure)
- Existing loader pattern: `packages/astro/src/utils/loader.ts:40-170` (`fs/promises`, `YAMLLoadError`, error structure)
- Existing schemas: `packages/astro/src/utils/collections-schemas.ts:58-114` (`LocationPointSchema`, `RegionPolygonSchema`, `RouteLineSchema`)
- Existing dispatch: `examples/astro/otf/src/pages/poas/[poas].astro:61-91` (geometry-type if/else chain to extend)
- Existing global config integration: `packages/astro/src/utils/global-config.ts:30` (`loadGlobalMapConfig` pattern to mirror)
- Test conventions: `packages/astro/tests/utils/loader.test.ts:19-117` (real fs + tmpdir + per-test isolation)

### External

- [GeoJSON RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946) -- `id` field is optional, type-restricted to string|number
- [MapLibre GeoJSONSource](https://maplibre.org/maplibre-gl-js/docs/API/classes/GeoJSONSource/) -- `promoteId` precedent for property-as-id
- [Tippecanoe `--use-attribute-for-id`](https://github.com/mapbox/tippecanoe#options) -- ecosystem precedent for property-based feature IDs
- [Astro Content Collections](https://docs.astro.build/en/guides/content-collections/) -- frontmatter parsing, top-level await
- [Astro Imports Reference](https://docs.astro.build/en/guides/imports/) -- `import.meta.glob` constraints (string-literal-only)
- [Vite issue #7024](https://github.com/vitejs/vite/issues/7024) -- `addWatchFile` HMR caveat (informs V2 deferral)
- [Zod discriminated unions](https://zod.dev/api) -- pattern for the id-vs-property union

### Related work in this repo

- `feat: add block-level sources to MapBlockSchema` (PR #TBD, recently merged) -- companion feature for source-of-truth GeoJSON in YAML configs (this V1 is the parallel for collection items)
- `0.2.0` core release -- introduced block-level sources; this feature is the natural follow-up at the Astro layer
