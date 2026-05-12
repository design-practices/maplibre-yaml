# Testing criteria — PR #20 (GeoJSON feature references)

Evaluation matrix for merging `feat/geojson-feature-references` into `main`. Section A is automated and already passing locally; B-F need a human pass.

## Getting started (local testing)

The minimal example app at [`examples/astro/minimal`](examples/astro/minimal) is pre-wired with a `/showcase` page that exercises every scenario in section C.

```bash
pnpm install              # from repo root, picks up the workspace package
cd examples/astro/minimal
pnpm dev                  # http://localhost:4321
```

Then open **[http://localhost:4321/showcase](http://localhost:4321/showcase)** — the page has one labeled section per checklist scenario with anchor links matching the IDs below. Source: [`src/pages/showcase.astro`](examples/astro/minimal/src/pages/showcase.astro); fixture: [`src/data/sample.geojson`](examples/astro/minimal/src/data/sample.geojson) (11 features covering every geometry type + edge cases).

**Content-collection example** at [http://localhost:4321/poas/sample](http://localhost:4321/poas/sample) demonstrates `buildMapConfigFromEntry` resolving a `feature_ref` from a markdown entry; source markdown at [`src/content/poas/sample.md`](examples/astro/minimal/src/content/poas/sample.md).

**Error-case scenarios** (sections C.4 and C.5): the showcase page has a block of commented-out `errorRefs.*` declarations. Uncomment one plus its `buildFeatureMapConfig` call to trigger the documented error. The dev server compile should fail with the expected message; revert before testing the next.

---

## A. Automated checks (must pass before merge)

- [ ] **Test suite:** `pnpm --filter @maplibre-yaml/astro test`
  - Expected: 256 passing, 0 failing, 13 test files
  - Spot-check: search output for `FAIL` — should be absent
- [ ] **Typecheck:** `pnpm --filter @maplibre-yaml/astro typecheck`
  - Expected: 0 errors, 0 warnings, 6 hints (pre-existing, unrelated)
- [ ] **CI run on the PR:** all GitHub Actions checks green
- [ ] **Changeset present:** `.changeset/feat-feature-refs.md` exists and bumps `@maplibre-yaml/astro` minor
- [ ] **Lockfile in sync:** `pnpm install --frozen-lockfile` succeeds with no diff produced

---

## B. Public-API contract checks (light, mostly read-the-diff)

- [ ] **New exports listed in both barrels:**
  - From `@maplibre-yaml/astro`: `FeatureRefSchema`, `FeatureRef`, `assertValidFeatureRef`, `InvalidFeatureRefError`, `getCollectionItemWithFeatureRefSchema`, `loadFeatureFile`, `findFeature`, `clearFeatureCache`, `GeoJSONLoadError`, `FeatureLoadOptions`, `buildFeatureMapConfig`, `BuildFeatureMapOptions`, `buildMapConfigFromEntry`, `EntryGeometryFields`, `BuildMapConfigFromEntryOptions`, `buildMultiPolygonMapConfig`, `MultiPolygonMapOptions`, `MultiRegionPolygon`, `buildMultiLineStringMapConfig`, `MultiLineStringMapOptions`, `MultiRouteLine`
  - Same set exported from `/utils` subpath
  - Spot-check: `git diff main..HEAD -- packages/astro/src/index.ts packages/astro/src/utils/index.ts`
- [ ] **No existing exports renamed or removed.** The PR is purely additive at the public level — verify by inspecting the export lines that existed in `main`.
- [ ] **TypeScript types resolve:** importing `FeatureRef` from `@maplibre-yaml/astro` in a downstream test file (Astro 5 content collection) should not produce a `cannot find module` error.

---

## C. Behavior verification (run the dev server)

Set up a minimal Astro project that depends on `@maplibre-yaml/astro` at the branch SHA, then verify each scenario.

### C.1 Happy paths — `/test/feature-refs` page

All sections pre-wired in [the test page](examples/astro/otf/src/pages/test/feature-refs.astro). Walk top-to-bottom.

- [ ] **Point** (`#c1-point`) — single circle marker at the Point coords
- [ ] **MultiPoint** (`#c1-multipoint`) — three purple markers; `markerColor` applied
- [ ] **LineString** (`#c1-line`) — 5-point line with two endpoint markers
- [ ] **MultiLineString** (`#c1-multiline`) — TWO green segments and FOUR endpoint markers (not one segment, not two endpoints)
- [ ] **Polygon** (`#c1-polygon`) — blue fill + outline
- [ ] **MultiPolygon** (`#c1-multipolygon`) — TWO red polygons (not one). Verify by inspecting the layer source or zooming/panning
- [ ] **GeometryCollection (single inner)** (`#c1-geomcoll-single`) — dispatches to the inner Point; single circle marker
- [ ] **3D position handling** (`#c1-altitude`) — section displays the computed center; verify it is `[-73.9826, 40.6725]` with NO altitude leak (source coord is `[-73.9826, 40.6725, 42]`)
- [ ] **Match-by-property** (`#c1-match`) — resolves the same feature as the Polygon section above

### C.2 mtime-aware cache invalidation (NOT Vite HMR)

The GeoJSON file is read via `fs.readFile` at build time, not imported through Vite's module graph. Vite cannot watch it; what's actually guaranteed is mtime-cache invalidation on the next request.

- [ ] Edit `examples/astro/minimal/src/data/sample.geojson` while `astro dev` is running (e.g., shift `polygon-1`'s coords by 0.001).
- [ ] **Manually reload** the showcase page in the browser. The polygon should appear in the new location.
- [ ] The dev server should NOT need a restart — mtime change alone is enough to invalidate the cache.
- [ ] (Not blocking, but note for future PRs: Vite-graph integration for true HMR auto-refresh would be a feature add. Tracked in todo P3-034 / new follow-up.)

### C.3 Override precedence — `/showcase#c3-override` + `/poas/sample`

- [ ] **[/showcase#c3-override](http://localhost:4321/showcase#c3-override)** — click the polygon. Popup title shows `"OVERRIDE: name set on the ref"`, NOT the source feature's name. Fill is teal, not blue.
- [ ] **`buildMapConfigFromEntry` happy path:** [/poas/sample](http://localhost:4321/poas/sample) renders the polygon from `feature_ref` in markdown frontmatter. To exercise the inline-geometry path, edit `examples/astro/minimal/src/content/poas/sample.md` and replace the `feature_ref` block with the inline `location` / `route` / `region` example from the markdown body. Page should still render. Revert after.
- [ ] **Schema-strict XOR:** edit `sample.md` to add `location: { coordinates: [0, 0] }` underneath the existing `feature_ref`. Dev server should reject the entry at parse time with a Zod error mentioning `feature_ref alongside location`. Revert after.

### C.4 Error UX (uncomment-and-reload via the showcase page)

Open [`examples/astro/minimal/src/pages/showcase.astro`](examples/astro/minimal/src/pages/showcase.astro). At the top there's a block of commented-out `error*Ref` declarations. To trigger each one, uncomment the const AND add a corresponding `await buildFeatureMapConfig({ ref: errorMultiGeomColl }, globalMapConfig)` line near the existing `Promise.all` block. Save; the dev server should reject with the expected message. Revert after each.

- [ ] **`errorMissingFile`** — `Cannot find GeoJSON file: ...`
- [ ] **`errorMissingFeature`** — `No feature with id "does-not-exist" found in ...; File contains N features; Sample ids: ...`
- [ ] **`errorMultiGeomColl`** — `GeometryCollection feature ... has 2 geometries ... V1 supports single-geometry collections only. Split into separate features ...`
- [ ] **`errorDegenerateLine`** — `LineString feature in ... has fewer than 2 coordinates (got 1); cannot render a degenerate line.`
- [ ] **`errorXorBoth`** — error class is `InvalidFeatureRefError`; message contains `exactly one of`
- [ ] **`errorXorNeither`** — error class is `InvalidFeatureRefError`; message contains `either ... or`
- [ ] **Empty `match`.** Add `match: { property: "x" }` (no `equals`) to any existing ref — Zod rejects at parse time
- [ ] **Multi-match.** Edit `sample.geojson` to give two features the same `ref_id`, then visit [/showcase#c1-match](http://localhost:4321/showcase#c1-match) — error names the candidates. Revert after.

### C.5 Security paths (uncomment-and-reload)

Same pattern as C.4 — uncomment in `showcase.astro`.

- [ ] **`errorTraversalUp`** — `feature_ref.source resolves outside the project root. Got: "../../...etc/passwd.geojson" -> "..."`
- [ ] **`errorAbsoluteDefault`** — `feature_ref.source is an absolute path ("/etc/passwd"), which is rejected by default for security. ... pass { allowAbsolutePaths: true } ...`
- [ ] **Opt-in absolute path works:** add a temporary file outside the project root (e.g., `/tmp/test.geojson` with `{ "type": "FeatureCollection", "features": [] }`), then add a ref using that path AND `loadOptions: { allowAbsolutePaths: true }` in the `buildFeatureMapConfig` call. Load succeeds (then errors on "no feature found" since the file is empty — that's fine, it proves the opt-in worked).
- [ ] **Symlink-escape blocked.** Create a symlink: `ln -s /etc/hosts examples/astro/minimal/src/data/escape.geojson`; add a ref with `source: "./src/data/escape.geojson"`. Dev server rejects with `symlink resolves outside the project root`. Clean up: `rm examples/astro/minimal/src/data/escape.geojson`.
- [ ] **`projectRoot` override:** add `loadOptions: { projectRoot: "/tmp" }` to any ref using a tmpdir-absolute path; relative paths now resolve against `/tmp`, not `process.cwd()`.

### C.6 Style-override warnings — `#c6-style-warn` section

- [ ] **Open the dev-server terminal log.** When the page renders, you should see exactly ONE warning:
  ```
  feature_ref: style override(s) [markerColor, width] do not apply to Polygon geometry from "..."; they will be ignored.
  ```
- [ ] **Dedupe holds.** Hard-reload the page. The warning should NOT re-emit (per `(source, geomType, irrelevant-keys)` dedupe key). It does re-emit if you restart the dev server (cache cleared) — that's correct.
- [ ] **No false positives.** None of the other sections on the test page should emit warnings; they all match style fields to geometry families.

### C.7 Performance budgets (optional / informational)

Not exercised by the test page directly — these are best verified via the existing unit tests (already passing) or manually:

- [ ] **Small fixture cache behavior** — covered by `tests/utils/feature-ref-loader.test.ts > lazy per-property index > does not build an index ... below the threshold`
- [ ] **Large fixture cache behavior** — covered by the same test file, `builds an index on second access for a large file`
- [ ] **100MB rejection** — would require generating a real 100MB file. Skip unless you want manual confirmation; the constants `HARD_ERROR_BYTES = 100 * 1024 * 1024` and the rejection branch in `doLoadFeatureFile` are well-tested in isolation
- [ ] **50MB warning** — same caveat as above

---

## D. Cross-package regression (light)

- [ ] Run the `docs` site build (if there's a docs build script). The new section in `docs/src/content/docs/integrations/astro.mdx` should render without Starlight errors.
- [ ] If there's an example site in the monorepo (e.g., `apps/example` or `packages/example`), build it. Existing maps should still render — the public API is additive and the existing builders kept the same signatures.

---

## E. Forward-compatibility spot checks (one minute each)

These confirm the seven constraints called out in the changeset still hold:

- [ ] **FC1:** `FeatureRefSchema` is a `ZodObject` (no `superRefine`). `grep "superRefine" packages/astro/src/utils/feature-ref-schema.ts` — only the `applyMutualExclusivityRefinement` (on the collection-helper, not the bare ref schema) should appear.
- [ ] **FC2:** Unknown future keys on the `match` object don't throw. The test `feature-ref-schema.test.ts > forward-compatibility` covers this.
- [ ] **FC3:** `_getCacheEntryDebug` is `@internal`. `grep _getCacheEntryDebug packages/astro/src/index.ts packages/astro/src/utils/index.ts` — should return nothing.
- [ ] **FC4:** Both `GeoJSONLoadError` and `YAMLLoadError` accept `cause` via the options param.
- [ ] **FC5:** `buildMultiPolygonMapConfig` emits a `geometry.type === "MultiPolygon"` feature (one feature, not N single-Polygons). Check the snapshot in `feature-ref-builder.test.ts > MultiPolygon`.
- [ ] **FC6:** Cache is module-private. The `fileCache` Map is not exported. Only `clearFeatureCache` and `_getCacheEntryDebug` reach in, and the latter goes through `CacheDebugSnapshot`.
- [ ] **FC7:** Builder return types stay `Promise<MapBlock>` (or `MapBlock` for the sync builders).

---

## F. Release readiness

- [ ] **Changeset accurately describes the user-facing change** — read `.changeset/feat-feature-refs.md` end-to-end.
- [ ] **Behavior-change callout.** The "absolute paths rejected by default" callout is in the PR description and the changeset. Confirm both before merge.
- [ ] **README and docs site are consistent.** Spot-check that both render the same examples (the docs site duplicates the README's GeoJSON Feature References section).
- [ ] **No stray TODOs in committed code** beyond the two intentional ones:
  - `// TODO(v2): if cache size grows past ~20 entries…` in `feature-ref-loader.ts`
  - Pending todos in `todos/` (planning artifacts, not code)
- [ ] **Pending todos are tracked for follow-up:** `024`, `025`, `026`, `028`, `034` remain pending by design. Confirm they're noted in the PR description's deferred-items list.

---

## Deferred items (NOT merged here — tracked in `todos/`)

These items surfaced during review and were explicitly deferred. If any are blockers for the consumer of this package, flag in PR review before merge.

| ID | Severity | Summary |
|---|---|---|
| 024 | P2 | `as`-casts in test files indicate weak public layer types; needs typed test helpers |
| 025 | P2 | `fileCache` has no eviction policy (only matters in long `astro dev` sessions) |
| 026 | P2 | Large MultiPolygon/MultiLineString MapBlock serialization size — warning belongs in rendering component |
| 028 | P3 | Grouped minor polish from first review |
| 034 | P3 | 7 of 16 sub-items deferred from second review: tagged-union cleanup in builder helpers, `Feature<Point>` typing, shared field list, test-only `_getCacheEntryDebug` gate, closure-returning lookup API, serverless-detection inversion, vitest benchmark |

---

## Sign-off

- [ ] Reviewer 1: ___________  (technical review)
- [ ] Reviewer 2: ___________  (security review of the path-traversal / absolute-path changes)
- [ ] All A-section checks green
- [ ] At least C.1, C.4, and C.5 sections walked through manually with a real `astro dev` session
- [ ] Behavior change (absolute paths default reject) communicated to known consumers if any exist
