# feat: GeoJSON Schema Alignment (Scoping Draft)

**Phase:** 5 of the [meta-plan](./meta-plan-stabilization-and-roadmap.md) — the destination the stabilization arc clears the way for
**Status:** Scoping draft — needs a working session with Mario before an implementation plan is written
**Depends on:** [rfc-schema-versioning.md](./rfc-schema-versioning.md) (this is the expected `version: 2`), JSON Schema pipeline (Phase 2), warn-mode validation (Phase 2)

## Overview

Mario's stated direction (2026-07-04): *transition the schema to conform to GeoJSON more explicitly than it does now.* This document inventories where the current schema diverges from RFC 7946, lays out three candidate levels of conformance, and lists the decisions needed before implementation planning. It deliberately does not commit to a design — the scope hinges on questions only Mario can answer (§ Open questions).

## Where we diverge from GeoJSON today (inventory)

**Authoring shapes (Astro frontmatter / builders) — the invented conventions:**

| Current shape | Where | GeoJSON equivalent |
|---|---|---|
| `location: { coordinates: [lng, lat], name }` | `collections-schemas.ts`, `buildPointMapConfig` | `Feature<Point>` with `properties.name` |
| `locations: [...]` | `buildMultiPointMapConfig` | `FeatureCollection<Point>` |
| `region: ...` (polygon coords) | `buildPolygonMapConfig` | `Feature<Polygon>` |
| `route: ...` (line coords) | `buildRouteMapConfig` | `Feature<LineString>` |
| `feature_ref: { file, id \| match: {property, equals} }` | feature-ref system | reference *into* GeoJSON — already GeoJSON-native in spirit |

**Core schema:**
- Inline `source.data` accepts GeoJSON but validation is shallow — not a real RFC 7946 check (geometry-type/coordinates-arity mismatches pass through to MapLibre).
- Coordinate order is already `[lng, lat]` throughout (GeoJSON-correct) — protect this; never introduce lat/lng variants.
- Popup DSL's `property:` keys implicitly address `feature.properties.*` — undocumented as such.
- 3D positions: the feature-ref builder strips altitude (`to2D`); the authored shapes don't state whether `[lng, lat, alt]` is legal (GeoJSON says yes).
- Naming adjacent to (but not part of) GeoJSON: `mapStyle` vs MapLibre's `style`, top-level `center`/`zoom` hoisted from `MapOptions` — decide whether this alignment pass also settles those or explicitly leaves MapLibre-spec naming alone.

## Candidate conformance levels

**Level 1 — GeoJSON as an accepted input everywhere (additive, no version bump).**
Every place that takes an invented shape also accepts the standard one: `location:` may be a `Feature<Point>` or bare `Geometry`; builders accept `Feature`/`FeatureCollection` directly; inline `data:` is validated as real RFC 7946 (via zod GeoJSON schemas — we already depend on `@types/geojson`). Invented shapes remain as sugar. Cheap, backward compatible, but leaves two ways to author everything — the docs/agent-ambiguity problem the stabilization arc just fixed, reintroduced.

**Level 2 — GeoJSON is canonical; invented shapes are documented sugar that normalizes to it (recommended starting hypothesis).**
Internally everything becomes `Feature`/`FeatureCollection` immediately after parse (single normalization step per builder/schema). Docs, JSON Schema, and llms.txt present the GeoJSON form as canonical; `location`/`region`/`route` are documented as shorthand with their expansion shown. Deprecation of the sugar is a separate later decision, not part of this level. This keeps existing content collections working while making the mental model "it's just GeoJSON."

**Level 3 — GeoJSON only; invented shapes removed (`version: 2` + `mlym migrate`).**
Frontmatter carries `geometry:`/`feature:`/`features:` (or `feature_ref`); the sugar shapes are removed with mechanical migration. Cleanest contract, best for agents (one way to say everything), real migration cost for existing sites (OTF: 57 POA files — though those already use `feature_ref`, which survives unchanged).

A plausible path is 2 → 3: ship Level 2 in one minor with deprecation warnings on the sugar (the warning channel exists by then), collect real-world friction, then decide whether Level 3 rides the v2 bump or the sugar earns permanence.

## Interactions to resolve during scoping

- **Feature-refs V2 backlog** (from `feat-geojson-feature-references-v1.md`): multi-feature refs, compound matchers (`all`/`any`/`in`), Mapbox-style filter expressions, `propertiesAllow` stripping. These are all "query GeoJSON declaratively" features — they should be designed *inside* the alignment, not bolted on after (e.g. if `match:` grows filter expressions, its syntax should be settled as part of the canonical GeoJSON story).
- **Strict validation:** the validation plan gates hard-strict on this release. If Level 2/3 ships as `version: 2`, it should ship strict (`additionalProperties: false` + `x-*` escape) so v2 starts clean.
- **Popup/property addressing:** if features are canonical, the popup DSL's `property:` should be documented (and maybe renamed in v2) as addressing `feature.properties`, with dotted-path access decided (currently unclear for nested properties).
- **Altitude policy:** accept `[lng, lat, alt]` everywhere per RFC 7946 and define where it's dropped (rendering is 2D unless fill-extrusion) — currently implicit in `to2D`.
- **What stays deliberately non-GeoJSON:** the map block itself (`config`, `layers`, `controls`) is MapLibre-spec territory, not GeoJSON; recommend this plan explicitly scopes to *data/geometry authoring surfaces* and leaves style-side naming (`mapStyle` etc.) alone unless Mario wants that fight in the same version bump.

## Open questions for Mario (the scoping session agenda)

1. **What does "conform to GeoJSON" mean to you concretely?** Authoring surfaces (frontmatter/YAML accept Features), internal representation, validation rigor (real RFC 7946 checking), or all three? Which pain prompted this — authoring friction, interop with external tools, agent generation, something else?
2. **Target level:** 1, 2, or 3 — and if 2, is eventual 3 the intent or is sugar permanent?
3. **Fate of each sugar shape:** `location` (with its `name`) is genuinely terser than a Feature for the blog case — keep? `region`/`route`/`locations` — same question. `feature_ref` presumably survives untouched?
4. **Does style-side naming (`mapStyle` → `style`?) ride the same version bump, or is v2 strictly the GeoJSON story?** (Recommend: strictly GeoJSON; one theme per version.)
5. **Should feature-refs V2 items (multi-ref, filters) land inside this alignment or after it?**
6. **Timeline pressure:** does OTF or map-party need anything here by a date, or does this sequence purely behind stabilization?

## Deliverable after the scoping session

A full implementation plan in the house format (dependency-ordered units, test plan, migration table old-shape → new-shape, `mlym migrate` rules, docs/JSON-Schema/llms.txt updates), written against the versioning policy decided in Phase 4.
