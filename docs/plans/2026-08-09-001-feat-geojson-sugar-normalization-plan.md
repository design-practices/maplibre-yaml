---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
type: feat
product_contract_source: ce-plan-bootstrap
origin: docs/plans/2026-08-07-001-feat-format-v2-definition-plan.md
bead: ml-4jq
title: "feat: GeoJSON sugar (location/locations/region/route) normalization, shared v1+v2"
date: 2026-08-09
depth: deep
---

# feat: GeoJSON sugar normalization (`location` / `locations` / `region` / `route`), shared v1+v2

**Bead:** ml-4jq · **Origin (WHAT):** format-v2 definition **V2-D2** (`docs/plans/2026-08-07-001-feat-format-v2-definition-plan.md`) · **Unblocks:** ml-0fg.2 (sugar provenance) · **Product Contract preservation:** unchanged — V2-D2 fixes the WHAT; this plan is the HOW.

---

## Summary

Format v2 keeps `location`, `locations`, `region`, and `route` as **documented GeoJSON sugar** (V2-D2): shorthand that "normalizes to `Feature`/`FeatureCollection` immediately after parse." Core does not implement this today — `read-v2.ts:20` carries an explicit deferral note, and `normalize.ts` has no sugar handling. This epic builds the expansion as a **shared, pre-validation transform** on the parsed block so a sugar document produces an identical model whether authored in v1 or v2 form, and so the expanded Feature flows through the RFC 7946 validation the v2-parser epic already shipped. It reconciles the four sugars with `@maplibre-yaml/astro`'s existing builder shapes (`map-builders.ts`), ships a browser demo-as-test and an Astro example/test in the same pass (standing preference, extended to Astro), and leaves a provenance seam so ml-0fg.2 is unblocked rather than blocked twice.

## Problem Frame

- **What's missing:** V2-D2 promises four authoring shorthands. Neither front end expands them: `readV2Block` was scoped only to match the existing v1 model (which has no sugar), and `normalizeMapBlock` never had it. So the sugar is documented-but-inert.
- **Why it must be shared:** AE2 (a v1 doc and its v2 twin normalize deep-equal) is the format's linchpin. If sugar expanded in only one front end, a sugar doc would break AE2. The expansion has to be one code path both surfaces reach.
- **Why placement is the crux:** the v2 RFC 7946 hard-error lives *in the schema* (`GeoJSONSchema` composed onto `data`/`prefetchedData` in `map-v2.schema.ts`), and the parser validates during `safeParseMapBlock` — *before* the consumer calls `toModel`. If expansion ran inside `normalizeSource`/`readV2Source` (which execute inside `toModel`, after validation), the expanded Feature would never be RFC-validated and the raw `location:`/`region:` keys would hit the schema as unknown keys. Expansion must precede schema validation.
- **Why Astro is in scope:** `map-builders.ts` already encodes the four sugars' input shapes (`LocationPoint`/`RegionPolygon`/`RouteLine` in `collections-schemas.ts`). Core's expansion must mean the same thing as the Astro builders, and — per the standing preference, explicitly extended to Astro — Astro-touching work ships its example/test in the same pass.

## Requirements

- **R1.** Four sugars expand format-wide: `location` → `Point` Feature; `locations` → `FeatureCollection` of `Point`s; `region` → `Polygon` Feature; `route` → `LineString` Feature. (Covers V2-D2.) "Format-wide" means every authoring surface that reaches a geojson source — the standalone map-block path **and** the multi-page `RootSchema`/`pages:` path (see OQ1); a sugar doc must expand identically wherever it is authored.
- **R2.** Expansion is a single shared step both v1 and v2 documents flow through; a v1-sugar doc and its v2 twin normalize **deep-equal** (AE2 preserved).
- **R3.** Expansion runs **before** GeoJSON schema validation, so the expanded Feature is what the v2 RFC 7946 check (hard error) and the v1 lenient path see. It introduces **no new RFC-7946 validation** (that stays the schema's job); it does introduce its own *structural* input check (enough to build the Feature) and an error-re-anchoring step so schema errors on the expanded `data.*` path report against the authored sugar node, not the synthesized `data` key (see OQ2).
- **R4.** The sugar node carries **geometry + `name`/`description`** only; `name`/`description` land in Feature `properties`. Styling/camera fields (`markerColor`, `zoom`, `color`, `width`, `fillColor`, `strokeColor`, `fillOpacity`) are **not** accepted on a core sugar node — they are layer-paint/camera concerns with no home in `source.data`. An unrecognized key on a sugar node is a validation error, not a silently smuggled property. (Consequence for Astro: a caller holding a richer `LocationPoint`/`RegionPolygon`/`RouteLine` must **project** the node down to `{coordinates,name,description}` before calling the expander — see U4/KTD4.)
- **R5.** Sugar occupies the **source `data` position** on a **`type: geojson` source**: such a source may carry exactly one of `location`/`locations`/`region`/`route` **in place of** `data`/`url`. Presence of a sugar key plus `data`/`url`, more than one sugar key, or a sugar key on a non-geojson source is an error with a sugar-specific message (not a generic source-union failure). Map-level "author a whole map from a location" sugar is **out of scope** (that is the Astro builders' higher-level job).
- **R6.** Malformed sugar input surfaces a clear, path-anchored error through the parser's existing error channel. Split by kind (see OQ2): **structural** malformation the expander must catch to build a Feature at all (non-array `locations`, empty `route`, a sugar key on a non-geojson source, mutual-exclusion violations) is a hard error under **both** v1 and v2; **coordinate-value** strictness (position element count, numeric types) is left to the GeoJSON schema, so it stays a v2 hard error and a v1 lenient pass — preserving the inherited dual posture rather than re-implementing it in the expander.
- **R7.** Core's expansion and Astro's `map-builders.ts` agree on the geometry + `{name,description}` Feature for all four sugars (`location`, `locations`, `region`, `route`), proven by test — the agreement is asserted against `expandGeoSugar(project(node))`, since the Astro node carries paint/camera fields the expander rejects (R4). Whether Astro's builders are *refactored* to call the expander (structural single-sourcing) or merely *tested* against it (agreement coverage) is the U4 scope fork (see OQ3).
- **R8.** The expander records enough (sugar kind + original authored node) that ml-0fg.2 can add provenance recording without re-architecting the expander. ml-4jq itself records nothing into the model (no consumer exists yet).
- **R9.** Ships a browser demo-as-test (authoring all four sugars in YAML, rendered, wired into `pnpm verify:browser`) and an Astro example/test, committed alongside the code. `pnpm presubmit` (incl. `docs:validate-snippets`) is green.

---

## High-Level Technical Design

The load-bearing decision is **where** expansion sits in the pipeline. Today:

```
YAML string
   │  YAMLParser.safeParseMapBlock
   ▼
raw parsed JS object ──► schema.safeParse (v1 MapBlockSchema  OR  v2 MapBlockV2Schema)
                                │   └─ v2: GeoJSONSchema validates source.data (RFC 7946, HARD ERROR)
                                ▼
                        validated block  ──► toModel(block)
                                                  │  v1: normalizeMapBlock → normalizeSource → partition
                                                  │  v2: readV2Block       → readV2Source   → partition
                                                  ▼
                                              MapModel { style, runtime }
```

Sugar expansion is inserted as a pre-validation pass on the raw parsed object, version-aware about where sources live:

```
raw parsed JS object
   │  expandGeoSugar(block, version)      ◄── NEW (this epic)
   │    • walk source positions:
   │        v1: sources{name}, layers[].source (inline)
   │        v2: style.sources{name}, style.layers[].source (inline)
   │    • replace a `location|locations|region|route` key with `data: <Feature|FeatureCollection>`
   │    • enforce mutual exclusion with data:/url:
   │    • emit parse-channel errors for malformed sugar
   ▼
schema.safeParse  ──► GeoJSONSchema now validates the *expanded* Feature (R3)
   ▼
toModel  ──► normalizeSource / readV2Source see a plain `data:` source; no sugar awareness needed
```

Two consequences worth stating explicitly:

1. **Single seam, not two call sites.** Because expansion precedes the version-forked schema and both readers see only the expanded `data:`, `normalizeSource` and `readV2Source` need **zero** changes. This is stronger than "both readers call the same helper" — neither reader knows sugar exists. AE2 for sugar is then inherited: identical expanded input → identical normalization.
2. **No new validation.** The expander validates its *input* (coordinate well-formedness) and delegates *output* validation to the existing GeoJSON schema by producing a real `data:` value. It never re-implements RFC 7946.

### Sugar → GeoJSON mapping (reconciled with `map-builders.ts`)

| Sugar key | Input shape (matches `collections-schemas.ts`) | Expands to | Properties |
|---|---|---|---|
| `location` | `{ coordinates: [lng,lat], name?, description? }` | `Feature<Point>` | `{ name, description }` |
| `locations` | `[{ coordinates, name?, description? }, …]` | `FeatureCollection<Point>` | per-feature `{ name, description }` |
| `region` | `{ coordinates: Position[][] (rings), name?, description? }` | `Feature<Polygon>` | `{ name, description }` |
| `route` | `{ coordinates: Position[] (≥2), name?, description? }` | `Feature<LineString>` | `{ name, description }` |

`name`/`description` default to `""` when absent (matching `buildPolygonLayers`/`buildRouteLayers`/`buildPointMapConfig`, which write `name: region.name ?? ""`). `MultiPolygon`/`MultiLineString` are **not** core sugar (they are not in the V2-D2 named set) — authored as canonical GeoJSON; Astro keeps its `MultiRegionPolygon`/`MultiRouteLine` builders as a builder-only convenience.

---

## Key Technical Decisions

- **KTD1 — Expansion is a pre-validation transform on the raw block, not a step inside `normalizeSource`/`readV2Source`.** Forced by ordering: v2 RFC 7946 validation runs in the schema during `safeParseMapBlock`, before `toModel`. Placing expansion in the readers would leave the expanded Feature unvalidated and surface `location:` as an unknown key. **Seam location is exact:** in the map-block path, *after* version detection (so the walker knows v1 `sources`/inline vs v2 `style.sources`/inline) and *before* `validateAgainst`/`schema.safeParse` — not at the very top of `safeParseMapBlock` (version isn't known yet) and not inside `materialize`. (This is the one place the epic's framing needed correcting.)
- **KTD1a — The transform desyncs error positions; re-anchoring is a first-class sub-decision, not free.** `validateAgainst` maps Zod errors back to the *original* YAML AST via `positionForPath(doc, lineCounter, err.path)`. After the transform, a schema error on the expanded Feature carries a `…data.features.0.geometry.coordinates` path the author never wrote, so position lookup finds no node and the error is caret-less and points at a non-existent key — directly falsifying the "path-anchored, delegation is free" premise. The recommended resolution (OQ2) is to **re-anchor**: remap any error path under the synthesized `data` back to the sugar key's source position before the error is emitted, so the v2 RFC-7946 hard error reports against `location:`/`region:` where the author can act on it. The `z.preprocess`/schema-`transform` alternative (expand inside the source schema, keeping Zod's path context intact) is the other way to get synced paths; it is rejected here for the TS7056 schema-surface cost the source union already carries, but it is the named alternative, not an unconsidered one.
- **KTD2 — Sugar is a source `data`-position value on a `type: geojson` source, carrying geometry + `name`/`description` only.** V2-D2 says "normalize to `Feature`/`FeatureCollection`" — a value expansion, not a layer/map generator. Styling and camera fields have no home in `source.data`; accepting them there would smuggle paint into data. They stay a layer/camera concern (and remain the Astro builders' territory). An unknown key on a sugar node is an error (R4); a sugar key on a non-geojson source is a sugar-specific error, not a generic source-union failure (R5).
- **KTD3 — The four V2-D2-named sugars only; no `Multi*` sugar.** Matches the definition doc exactly and keeps the core surface tight. Multi-geometry is authored as canonical GeoJSON.
- **KTD4 — Astro converges on the shape; whether it *refactors to delegate* or *only tests for agreement* is deliberately staged (coverage-first).** The Astro builders emit whole maps (data + layers + paint + popups + camera bounds); core sugar emits only `data`. **Default this epic to coverage-first (OQ3):** an Astro test asserting each builder's base Feature deep-equals `expandGeoSugar(project(node))` — projecting the richer `LocationPoint`/`RegionPolygon`/`RouteLine` down to `{coordinates,name,description}` first, since the expander rejects paint/camera keys (R4). Full delegation (builders call the expander — the `!html` de-drift, giving no-drift-*by-construction*) lands in the same epic **only if the diff proves clean**; otherwise it is a filed follow-up. State plainly that coverage-only prevents drift by *test*, not by *construction* — they are not equivalent, and the follow-up must restore structural single-sourcing.
- **KTD5 — Provenance is a return-shape seam, not a model change, and carries no standalone test until a consumer exists.** `expandGeoSugar` returns `{ kind, value, source }` (source = the original authored sugar node); every current caller uses only `.value`. `kind`/`source` are already in hand, so the seam is nearly free — but do **not** add a dedicated provenance test in ml-4jq (no consumer exercises it); ml-0fg.2 adds the test when it threads the fields into a model slot. This unblocks ml-0fg.2 without shipping tested-but-dead behavior.
- **KTD6 — The expander validates *structure*, not coordinate values; it never re-implements RFC 7946.** It checks only what it needs to build a Feature (array shapes, `route` length ≥ 2, `locations` is an array) and defers position element-count / numeric-type strictness to `GeoJSONSchema` (v2 hard error, v1 lenient) — this is what keeps the dual posture inherited (R6) and keeps "sugar is just shorthand" true for malformed coordinates under v1. Structural errors emit through the parser's `ParseError` channel so they read like every other parse error.

---

## Implementation Units

### U1. Core geo-sugar expander (`packages/core/src/model/sugar.ts`)

**Goal:** A pure, front-end-agnostic module that turns one sugar node into a GeoJSON `Feature`/`FeatureCollection`, validating its input and preserving provenance in its return shape.

**Requirements:** R1, R4, R5 (the "exactly one sugar key" half, via `detectSugarKey`), R6, R8, KTD2, KTD5, KTD6.

**Dependencies:** none (leaf module).

**Files:**
- `packages/core/src/model/sugar.ts` (create)
- `packages/core/tests/model/sugar.test.ts` (create)
- `packages/core/src/model/index.ts` (modify — export the expander + types for U2 and Astro/U4)

**Approach:**
- Export `SUGAR_KEYS = ["location", "locations", "region", "route"] as const`, a `detectSugarKey(source)` that returns the single present sugar key or `null` and errors if more than one is present (implements the "exactly one" half of R5), and a `project(node)` helper that narrows a richer node to `{coordinates,name,description}` (used by Astro/U4).
- Export `expandGeoSugar(node, key)` returning a discriminated result `{ kind, value: Feature | FeatureCollection, source: <original node> }`. Internal per-kind builders (`expandLocation`, `expandLocations`, `expandRegion`, `expandRoute`) construct the geometry and `{ name: name ?? "", description: description ?? "" }` properties per the mapping table.
- **Structural validation only (KTD6):** check the shapes needed to *build* the Feature — `route` has ≥2 positions, `locations` is an array, `region.coordinates` is an array of rings, each innermost coordinate is an array. Do **not** enforce position element-count or numeric-type strictness — that is `GeoJSONSchema`'s job downstream (v2 strict, v1 lenient), which is what keeps the dual posture inherited (R6). On failure, return a structured error (not a throw) the caller (U2) converts to a `ParseError`.
- Reject unrecognized keys on the node (anything other than `coordinates`/`name`/`description`, or the per-item equivalents for `locations`) with a message naming the accepted keys and pointing at paint/camera as the wrong home (R4).
- **Prototype-pollution safety (security):** build `geometry`/`properties`/`Feature` objects with **fixed literal keys only** — never spread the author node into `properties`, and never generic-copy author keys. The unknown-key check must treat `__proto__`/`constructor`/`prototype` as rejected keys (R4), matching the `Object.defineProperty` discipline `normalize.ts`'s `partition()` uses for the same untrusted-input class. The expander must never return an object whose prototype was reparented.
- No dependency on parser or schema modules — this is a leaf so both the parser seam (U2) and Astro (U4) can import it without cycles.

**Patterns to follow:** the geometry/`properties` construction in `map-builders.ts` (`buildPointMapConfig` features, `buildPolygonLayers`, `buildRouteLayers`); the `__proto__`-safe construction discipline in `normalize.ts`'s `partition()`; the `{ kind, … }` discriminated-return style used elsewhere in `model/`.

**Test scenarios (`sugar.test.ts`):**
- `location` → a `Feature` with `geometry.type === "Point"`, coordinates preserved, `properties.name`/`description` present (defaulting to `""`).
- `locations` → a `FeatureCollection` with one `Point` feature per item, each carrying its own name/description.
- `region` → a `Feature<Polygon>` with ring nesting preserved (`Position[][]`).
- `route` → a `Feature<LineString>` with the coordinate array preserved.
- 3-element positions (`[lng,lat,alt]`) preserved, not truncated (RFC 7946 §3.1.1).
- Structural errors: `route` with a single position → error; `locations` not an array → error; `region.coordinates` not an array of rings → error. Each error names the path.
- Dual-posture boundary: a *coordinate-value* malformation (e.g. a 1-element position, a string where a number belongs) does **not** error in the expander (deferred to the schema) — pins KTD6/R6.
- Unknown-key rejection: `location` with `markerColor`/`zoom` → error naming accepted keys (R4).
- `__proto__`/`constructor` as a sugar-node key → rejected per R4; no prototype is mutated and the returned object's prototype is unchanged (security).
- `project()` narrows a `LocationPoint` carrying `markerColor`/`zoom` down to `{coordinates,name,description}` (feeds U4).
- Purity: expanding the same node twice yields deep-equal output and does not mutate the input.
- (No standalone provenance test — `kind`/`source` are exercised when ml-0fg.2 adds a consumer, per KTD5.)

---

### U2. Wire the expander into the parse→validate seam, both surfaces (`yaml-parser.ts`)

**Goal:** Run `expandGeoSugar` on the raw parsed block before schema validation, for both v1 and v2 source positions and on both the standalone map-block and multi-page `RootSchema` paths, so the expanded Feature is what the schema validates, error positions report against the authored sugar node, and every front end inherits the expansion.

**Requirements:** R1, R2, R3, R5, R6, KTD1, KTD1a.

**Dependencies:** U1.

**Files:**
- `packages/core/src/parser/yaml-parser.ts` (modify — insert the pre-validation pass in the map-block path *after* version detection and *before* `validateAgainst`; wire the same walker into the `RootSchema`/`safeParse` path — see OQ1)
- `packages/core/tests/parser/geo-sugar-parse.test.ts` (create)

**Approach:**
- Add a version-aware walker that, given the raw parsed map block and its detected format version, visits every source position — v1: `sources[*]` and inline `layers[*].source`; v2: `style.sources[*]` and inline `style.layers[*].source` — and for any **`type: geojson`** source carrying a sugar key, replaces it with `data: expandGeoSugar(...).value` (dropping the sugar key). A sugar key on a non-geojson source is a sugar-specific `ParseError`, not a passthrough that trips a generic source-union failure (R5/KTD2).
- **Cover the multi-page path (OQ1):** the flagship `parse()`/`mlym validate` surface validates through `RootSchema` (`safeParse`), which nests `MapBlockSchema` and never calls `safeParseMapBlock`. Run the same walker over `pages[].blocks[]` map blocks (and root-level `sources:`/`layers:` `$ref` targets) so "format-wide" (R1) actually holds; without this, `pages:`-authored v1 sugar hits the geojson `superRefine` "requires url/data/prefetchedData" error.
- **Seam placement (KTD1):** *after* version detection (so the walker knows which surface it's on) and *before* `validateAgainst`/`schema.safeParse`, so the expanded `data:` reaches `GeoJSONSchema` (v2 hard error) / `z.any()` (v1 lenient) unchanged. Do **not** touch `normalizeSource`/`readV2Source`, and do **not** place the pass at the very top of `safeParseMapBlock` (version isn't known there) or inside `materialize`.
- **Re-anchor error positions (KTD1a):** because the transform rewrites `location:` → `data:`, remap any schema-error path under the synthesized `data` back to the sugar key's source position before the `ParseError` is emitted, so a v2 RFC-7946 hard error on the expanded geometry reports against `location:`/`region:` (with a caret) rather than a `data.features…` node absent from the source. Confirm the remap against `positionForPath(doc, lineCounter, err.path)`.
- Enforce R5 mutual exclusion: a source with a sugar key **and** `data`/`url` (or more than one sugar key) → a `ParseError` with the source's path.
- Convert U1's structured input errors into `ParseError`s on the parser's existing error path, so a malformed sugar doc fails to parse with a clear message rather than throwing.
- Confirm the seam runs after YAML materialization (so the merge-fan-out guard has already bounded the input) and before validation — the expander operates on already-guarded JS objects and introduces no new fan-out.

**Execution note:** Start from a failing parse-level test (a v2 sugar doc that should produce a valid `data:` FeatureCollection and, when the geometry is malformed, a v2 hard error *anchored at the sugar key*) before editing the parser — the ordering and the error-anchoring are the whole point of the unit and a red test pins both.

**Patterns to follow:** the existing `safeParseMapBlock` / `validateAgainst` / `positionForPath` flow in `yaml-parser.ts`; the `page.schema.ts` → `RootSchema` nesting for the multi-page path; the `ParseError` construction used elsewhere in the parser.

**Test scenarios (`geo-sugar-parse.test.ts`):**
- v2 source with `location:` parses to a source whose `data` is a `Feature<Point>`; no `location` key remains.
- v2 source with a **malformed** expanded geometry (e.g., `region` ring with a coordinate-value error) → parse **fails** with an RFC-7946 hard error, proving expansion precedes v2 validation (R3, KTD1), and the error position points at the `region:` key, not a `data.*` path (KTD1a).
- v1 source with the same coordinate-value malformation → parses (lenient `z.any()` path), proving the dual posture is inherited (R6).
- **Multi-page path:** a `pages:` document with a v1 `location:` sugar source expands and validates the same as the standalone block (R1/OQ1) — not a "requires url/data" error.
- Sugar key on a `type: vector` (or type-less) source → sugar-specific parse error, not a generic source-union failure (R5).
- Mutual exclusion: a source with both `location:` and `url:` → parse error naming the source path (R5).
- Two sugar keys on one source → parse error.
- Inline layer source carrying `route:` expands the same way as a named source.

---

### U3. AE2 corpus + equivalence for sugar (`read-v2.test.ts`)

**Goal:** Prove a v1-sugar document and its v2 twin normalize deep-equal, extending the AE2 corpus with a sugar case.

**Requirements:** R2.

**Dependencies:** U1, U2.

**Files:**
- `packages/core/tests/model/read-v2.test.ts` (modify — add a v1↔v2 sugar pair to the AE2 `describe`)

**Approach:** Following the existing `model(yaml)` helper (parse via `safeParseMapBlock` then `toModel`), add a pair: a v1 map with a geojson source authored via `location`/`region`/`route` sugar, and the v2 equivalent with the same sugar under `style.sources`. Assert the two models are deep-equal. Because expansion is pre-validation and shared, this should pass as a consequence of U2 — the test pins that the inheritance actually holds end-to-end.

**Test scenarios:**
- Covers AE2. A v1 sugar doc and v2 sugar doc (same `location`) → deep-equal `MapModel`, including the geojson `runtime.fetchStrategy: "runtime"` default on both sides.
- A `locations` FeatureCollection pair → deep-equal.
- A sugar doc and the equivalent doc authored with the **expanded** canonical GeoJSON `data:` → deep-equal models (sugar is truly just shorthand).

---

### U4. Astro reconciliation — agreement-first, delegation if clean (`map-builders.ts`)

**Goal:** Guarantee `location:`/`region:`/`route:` mean the same thing in YAML (core) and in the Astro helper. **Coverage-first (OQ3):** land a test proving each builder's base Feature agrees with the core expander; refactor the builders to *call* the expander (structural single-sourcing, the `!html` de-drift) only if that diff proves clean this epic, else file it as a follow-up.

**Requirements:** R7, KTD4.

**Dependencies:** U1 (and a core rebuild — Astro resolves `@maplibre-yaml/core` from its built `dist/`, so core must be rebuilt before Astro sees the new export).

**Files:**
- `packages/astro/tests/utils/map-builders.test.ts` (modify or create — shape-agreement tests; **always** shipped)
- `packages/astro/src/utils/map-builders.ts` (modify — *only if* delegation is clean: `buildPointMapConfig`, `buildMultiPointMapConfig`, `buildPolygonMapConfig`, `buildRouteMapConfig` build their `data.features` base Feature via the core expander; paint, camera bounds, endpoints, and `markerColor`-in-properties stay in the builder)

**Approach:**
- Rebuild core first so Astro's `dist` resolution sees `expandGeoSugar`/`project`.
- **Always:** add a test asserting each builder's base Feature deep-equals `expandGeoSugar(project(node)).value` on geometry + `{name,description}`. The `project()` step (from U1) is mandatory: the Astro `LocationPoint`/`RegionPolygon`/`RouteLine` carries `markerColor`/`zoom`/`fillColor`/… which the expander rejects (R4/KTD2), so the agreement is against the projected node, not the raw one.
- **If the diff is clean:** replace each builder's inlined `{ type:"Feature", geometry, properties:{name,description} }` construction with a call to the core expander, keeping everything the sugar has no home for (`markerColor` paint/property, route endpoint features, camera bounds/zoom, popup content). This is the no-drift-*by-construction* outcome (R7/KTD4).
- **If entangled:** stop at the agreement test, and file a follow-up bead for the delegation refactor. Record in the PR that coverage-only prevents drift by *test*, not by *construction* — the two are not equivalent, and the follow-up owns restoring structural single-sourcing. (This also affects U5's Astro example — see U5.)

**Execution note:** Decide delegation-vs-coverage from the actual diff, not up front. The agreement test is the floor either way.

**Patterns to follow:** the `!html` de-drift just shipped (Astro importing `YAML_PARSE_OPTIONS`/`htmlTag` from core instead of re-declaring); the existing builder structure and its test suite.

**Test scenarios (`map-builders.test.ts`):**
- Covers R7. `buildPointMapConfig({location})` emits a `data.features[0]` deep-equal to `expandGeoSugar(project(location),"location").value` on geometry + `{name,description}`.
- `buildPolygonMapConfig` / `buildRouteMapConfig` base Feature matches the core expander for the projected `region`/`route`.
- `buildMultiPointMapConfig` base Features match `expandGeoSugar(project(locations),"locations")` — the `markerColor`-in-properties extra stays builder-side and is asserted separately (covers the fourth sugar for R7).
- If delegation lands: builder-specific extras survive — route endpoints layer still present; `markerColor` still drives paint; camera bounds still fit; multi-point popup binding (`{property:"name"}`) still resolves. (Regression guard for the refactor.)

---

### U5. Browser demo-as-test, Astro example, and docs (`e2e/` + docs)

**Goal:** One artifact that is both the user-facing demo and the regression test for the four sugars, plus an Astro example and a docs snippet — committed in the same pass (standing preference, extended to Astro).

**Requirements:** R9.

**Dependencies:** U1, U2 (core rebuilt); U4 for the Astro example.

**Files:**
- `e2e/geojson-sugar.html` (create — authors all four sugars in YAML via `<ml-map>`, renders them; wired into `pnpm verify:browser`)
- an Astro example page under the Astro examples surface (create — a `.astro` page authoring a sugar-backed map; confirm the exact `examples/`/`docs/` location the repo uses)
- a docs snippet/guide section documenting the four sugars (modify the relevant docs page so `docs:validate-snippets` covers it)

**Approach:**
- Follow the existing `e2e/` demo-as-test convention (see the sibling pages wired into `verify:browser`): a single page authoring `location`, `locations`, `region`, and `route`, asserting each renders (source `data` present, layer visible). The page is the demo; the assertion is the test.
- Add an Astro example authoring a sugar-backed map so the Astro surface has a runnable, committed example (the reminder's bar). Note the example exercises the builder path regardless of the U4 delegation outcome — it does not *depend* on delegation landing; if U4 stays coverage-only, the example still stands as an Astro-surface demo of the equivalent authoring shape.
- Document the sugars with a snippet that `docs:validate-snippets` validates, so the docs example is proven, not decorative.

**Execution note:** Prefer runtime/smoke verification here (does it render, is the `data` a valid FeatureCollection) over unit assertions — the core semantics are already unit-tested in U1–U3; this unit proves the end-to-end authoring path.

**Test scenarios:**
- Test expectation: browser smoke — the page loads, each of the four sugars produces a rendered layer with a non-empty GeoJSON `data`. Wired into `pnpm verify:browser`.
- `docs:validate-snippets` passes on the new docs snippet.
- The Astro example builds under the Astro package's example/build path.

---

## Scope Boundaries

**In scope:** the four V2-D2-named sugars as source `data`-position shorthand on `type: geojson` sources, shared across v1/v2 and across the standalone-block and multi-page `RootSchema` paths via a pre-validation seam; structural input validation + parser-channel errors with re-anchored positions; AE2 sugar equivalence; Astro base-case Feature agreement coverage (with delegation if clean); browser demo-as-test, Astro example, docs snippet; a provenance return seam.

**Out of scope (non-goals):**
- Map-level "author a whole map from a `location`" sugar — that is the Astro builders' higher-level job, not core format sugar (R5).
- `MultiPolygon`/`MultiLineString` **sugar** — not in the V2-D2 set (KTD3); authored as canonical GeoJSON.
- Styling/camera fields on a sugar node (`markerColor`, `zoom`, `color`, `width`, `fillColor`, …) — rejected, not expanded (R4/KTD2).

**Deferred to follow-up work:**
- **ml-0fg.2 (sugar provenance):** consume the provenance seam (KTD5) to serialize `data:` back as the authored sugar. This plan unblocks it; it does not implement it.
- If U4 descopes to coverage-only, file a bead for the Astro builder→core-expander delegation.
- Warn-on-malformed-geometry under v1 (ml-ldv) is a separate, already-filed follow-up; the v1 lenient path here inherits today's behavior.

---

## Open Questions

These are the forks surfaced by the planning-review pass. Each carries a recommended default the implementer proceeds on unless overridden at desk review — they are decisions, not blockers.

- **OQ1 — Does sugar expand on the multi-page `RootSchema`/`pages:` path, or only standalone map blocks?** Review confirmed the seam-in-`safeParseMapBlock` design misses the `parse()`/`mlym validate` surface. **Recommended default: cover it** — extend the walker to `pages[].blocks[]` (and root-level `sources:`/`layers:` `$ref` targets), because R1 says "format-wide" and a `pages:`-authored sugar source otherwise fails with a confusing geojson `superRefine` error. The alternative (scope sugar to standalone blocks and narrow R1) is cheaper but leaves an inconsistent v1 surface; take it only if desk review decides `pages:`-nested sugar is not a real authoring affordance.
- **OQ2 — How are expanded-Feature validation errors re-anchored to the authored sugar node?** **Recommended default: remap** — after schema validation, rewrite any error path under the synthesized `data` back to the sugar key's source position (KTD1a), keeping the change local to the parser seam. Alternative: expand inside the source schema via `z.preprocess`/`.transform` (Zod keeps path context, no remap needed) — rejected for the TS7056 schema-surface cost, but the fallback if remapping proves brittle against `positionForPath`.
- **OQ3 — Does U4 refactor Astro's builders to call the expander this epic, or only test for agreement?** **Recommended default: agreement-first** — always ship the shape-agreement test; land the delegation refactor in this epic only if the diff is clean, else file it as a follow-up bead. Coverage-only prevents drift by test, not by construction — the follow-up owns restoring structural single-sourcing. (This keeps the Astro surface covered per the standing reminder without forcing an entangled cross-package refactor into a core-format epic.)

---

## Risks & Dependencies

- **R-ordering (highest):** the entire correctness of R3 hinges on the seam sitting after version detection and before `schema.safeParse`. Mitigation: U2's first test is a v2 malformed-geometry doc that must produce an RFC-7946 error — if the seam is misplaced, that test fails loudly. Do not merge U2 without it green.
- **Error-position desync (high — found in review):** the transform rewrites `location:` → `data:`, but `positionForPath(doc, …)` maps schema errors against the *original* AST, so a naive implementation reports the v2 RFC-7946 error against a `data.*` node the author never wrote (caret-less, misleading). Mitigation: KTD1a re-anchoring, pinned by a U2 test asserting the error position lands on the sugar key. Do not treat "delegate output validation to the schema" as free.
- **Coverage-scope mismatch (found in review):** the seam must cover the multi-page `RootSchema`/`pages:` path, not just `safeParseMapBlock`, or "format-wide" (R1) is false for the flagship `parse()`/`mlym validate` surface. Mitigation: OQ1 + the multi-page U2 test.
- **Core-before-Astro build ordering:** Astro resolves core from `dist/`. U4 and the Astro parts of U5 must rebuild core first or they will not see `expandGeoSugar`/`project` (this exact failure bit the `!html` de-drift). Mitigation: rebuild core as the first step of U4.
- **AE2 fragility:** a subtle difference in how v1 vs v2 reach the expanded `data` (e.g., inline-layer-source path) could break deep-equality. Mitigation: U3 covers named + inline + FeatureCollection cases; U2 covers inline layer sugar.
- **TS7056 pressure:** the source/layer schemas are already near TypeScript's inferred-type-serialization ceiling. Because expansion is a raw-object transform and adds **no** Zod surface to those unions (KTD1), this epic should not move that needle — this is also why the `z.preprocess` alternative (KTD1a) is rejected despite its position-sync benefit.
- **Merge-fan-out guard:** expansion runs post-materialization on already-guarded objects and adds no fan-out; confirm it does not bypass or precede the existing guard. Prototype-pollution: the new expander must hold the `partition()` `__proto__`-safety discipline (U1) since it constructs objects from untrusted input.

---

## Verification Contract

- `pnpm presubmit` green (build → typecheck → lint → test → docs:validate-snippets), routed through the box test-lane.
- `pnpm verify:browser` green, including the new `e2e/geojson-sugar.html`.
- U1–U3 unit/parser/AE2 suites green; U4 Astro shape-agreement suite green; the Astro example builds.

## Definition of Done

1. `location`/`locations`/`region`/`route` expand format-wide — v1 and v2, standalone-block and multi-page (OQ1) — to the mapped GeoJSON, shared by one pre-validation seam (R1–R3).
2. Expanded Features are validated by the existing v2 RFC 7946 schema (hard error) and the v1 lenient path — no new RFC-7946 code; validation errors re-anchor to the authored sugar node (R3, KTD1a).
3. AE2 holds for sugar: v1 and v2 twins normalize deep-equal (R2, U3).
4. Sugar nodes reject styling/camera keys (incl. `__proto__`) and enforce data/url + single-key + geojson-only mutual exclusion with clear structural errors, while coordinate-value strictness stays the schema's dual-posture job (R4–R6).
5. Core and Astro agree on the base-case Feature via the shape-agreement test (against the projected node); delegation refactor landed or filed as a follow-up (R7, U4, OQ3).
6. Browser demo-as-test + Astro example + docs snippet committed alongside the code; `pnpm presubmit` green (R9).
7. Provenance seam present (return shape only, no standalone test) so ml-0fg.2 is unblocked; nothing recorded into the model yet (R8).

## Assumptions

- Direct-planning bootstrap: the WHAT is fixed by V2-D2, so no requirements-only unified plan was enriched; the KTDs above are the scope decisions surfaced for desk review in lieu of a blocking scoping-confirm (autonomous mode).
- `e2e/` + `pnpm verify:browser` is the demo-as-test home and the Astro package has a runnable-example surface; the implementer confirms the exact example path against the repo's current conventions before creating files.
- The parser exposes a clean pre-validation seam **after version detection and before `validateAgainst`** in the map-block path (feasibility review confirmed this exists between version detection and `validateAgainst`). Note the seam must sit *after* detection — a fallback "at the top of `safeParseMapBlock`" would run before the version is known and cannot drive the version-aware walker, so that earlier-considered fallback is not viable.

## Sources & Research

- V2-D2 / V2-D3 — `docs/plans/2026-08-07-001-feat-format-v2-definition-plan.md` (sugar is canonical-GeoJSON shorthand; `config:` cut vs move).
- `packages/core/src/model/read-v2.ts:20` — the deferral note ("belongs before this reader, as a pre-pass on the parsed block") this plan implements.
- `packages/core/src/model/normalize.ts` — `normalizeSource`/`partition`/`SOURCE_RUNTIME_KEYS` (post-validation, untouched by this epic).
- `packages/core/src/schemas/geojson.schema.ts` — RFC 7946 schema + `PositionSchema` reused for input validation.
- `packages/core/src/schemas/source.schema.ts` — geojson source (`data: z.any()` v1; the field expansion targets).
- `packages/astro/src/utils/map-builders.ts` + `collections-schemas.ts` — the `LocationPoint`/`RegionPolygon`/`RouteLine` shapes reconciled here.
- `packages/core/tests/model/read-v2.test.ts` — the AE2 corpus U3 extends.
