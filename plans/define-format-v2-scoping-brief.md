# Define Format v2 — Scoping Brief

**Status:** Prepared for the define-v2 session (bead `ml-lc5.1`, epic `ml-16x`)
**Date:** 2026-08-07
**Source of authority:** [`docs/brainstorms/2026-07-24-library-direction-requirements.md`](../docs/brainstorms/2026-07-24-library-direction-requirements.md) (R8)
**Supersedes:** the Phase-5 D6 scoping questions in [`feat-geojson-schema-alignment.md`](./feat-geojson-schema-alignment.md), which grow into this session

---

## Why this session exists, and why it runs first

The 2026-07-24 direction doc reframed the library around the **erasability test**: every
feature is *sugar* (compiles to spec-valid `style.json`, nothing left over), *deviation*
(needs runtime JS), or *product* (needs a server). v2 is the format that makes that
boundary **visible in the file itself** rather than only in documentation.

The 2026-08-07 release scoping decided v0.5.0 = **emitter (R4) + extension registry
(R5)**, and that this session runs **before** implementation. The reason is direct: the
emitter's whole job is to consume the erasable half and reject or degrade the rest. If we
build it against v1's flat format and then split the format, we build the boundary twice.
Deciding the split first means the emitter is written once, against the shape it will keep.

Everything in this brief is a decision *for Mario*. Recommendations are marked **[rec]** and
exist to make disagreement cheap, not to pre-empt it.

---

## Part 1 — The erasability audit of the shipped surface (R2)

This is the factual input to the split, read off `packages/core/src/schemas/` at core 0.4.0.
R2 requires this classification to end up visible in the docs; producing it here means the
session argues about the boundary rather than discovering it.

### The finding that shapes the split

**`config:` is the problem child.** It is declared as a MapLibre `MapOptions` passthrough,
but MapOptions is two different things wearing one hat:

| `config:` key | Class | Why |
|---|---|---|
| `center`, `zoom`, `pitch`, `bearing` | **Sugar — erases** | These are style-spec *root properties*. They land in `style.json` verbatim. |
| `mapStyle` | **Sugar — erases by merge** | A URL to another style; R4's compile-time basemap merge resolves it. |
| `minZoom`, `maxZoom`, `maxBounds`, `minPitch`, `maxPitch` | **Deviation** | Map constructor options; no style-spec root equivalent. Degrade to absence. |
| `interactive`, `scrollZoom`, `boxZoom`, `dragRotate`, `dragPan`, `keyboard`, `doubleClickZoom`, `touchZoomRotate`, `touchPitch` | **Deviation** | Constructor-only interaction gating. Degrade to MapLibre defaults. |
| `hash`, `attributionControl`, `logoPosition`, `trackResize` | **Deviation** | Chrome and browser integration. Degrade to absence. |
| `fadeDuration`, `crossSourceCollisions`, `antialias`, `refreshExpiredTiles`, `renderWorldCopies`, `maxTileCacheSize`, `localIdeographFontFamily`, `preserveDrawingBuffer`, `failIfMajorPerformanceCaveat`, `locale` | **Deviation** | Renderer/runtime tuning. Degrade to defaults. |

So the split does not merely reorder top-level blocks — **it cuts through `config:`**. Any
proposal that keeps `config:` intact on one side of the line is wrong on the facts.

### Everything else

| Surface | Class | Notes |
|---|---|---|
| `sources:` (`type`, `url`, `tiles`, `data`, `cluster*`, `tolerance`, `buffer`, `lineMetrics`, `generateId`, `promoteId`, `attribution`, `source-layer`) | **Sugar — erases** | Straight to `style.sources`. |
| `sources[].refresh`, `.stream`, `.cache`, `.loading`, `.prefetchedData`, `.fetchStrategy`, legacy `refreshInterval`/`updateStrategy`/`updateKey` | **Deviation** | Degrades to **snapshot-on-load**: the emitter inlines or points at the current data and drops the liveness. |
| `layers[]` `id`, `type`, `source`, `source-layer`, `minzoom`, `maxzoom`, `filter`, `paint`, `layout`, `metadata` | **Sugar — erases** | Direct spec mapping. |
| `layers[].visible` | **Sugar — erases** | Becomes `layout.visibility`. |
| `layers[].before` | **Sugar — erases** | Resolves into array ordering. |
| `layers[]` `$ref` / `LayerReference` | **Sugar — erases** | Resolved at compile time. |
| `layers[].label`, `.toggleable`, `.legend` | **Deviation** | Legend/toggle chrome. Degrade to absence. |
| `layers[].interactive` (`hover.cursor`, `hover.highlight`, `click.popup`, `click.flyTo`, deprecated `*.action`) | **Deviation** | The interactions package (R7). Degrade to absence. |
| `controls:`, `legend:` (block level) | **Deviation** | Degrade to absence. |
| `type:`, `id:`, `className:`, `style:` (container CSS) | **Deviation** | Document plumbing and host DOM. Never reach `style.json`. |
| `scrollytelling`, `content`, `mixed`, `pages` blocks | **Outside the eject claim** | Stated explicitly in the direction doc; not a degradation, an exclusion. |

**Corroborating evidence this boundary is already real in the code:** 0.4.0's named-source
work (U7) had to *scrub* `refresh`, `cache`, `prefetchedData` and the legacy refresh fields
before handing a source to MapLibre, because they leaked into the spec object MapLibre
validates. That scrub list is the erasability boundary, discovered empirically under
pressure. v2 makes it declared instead of discovered.

---

## Part 2 — The decisions

### V2-D1 — Shape of the `style:` / `runtime:` split

The direction doc commits to the split existing. It does not fix its shape.

**Option A — Two top-level sections, hard cut** (as sketched in the interactions proposal):
`style:` holds camera + sources + layers + erasable layer props; `runtime:` holds controls,
legend, interactions, live-data, toggle chrome, container. Layers appear in `style:`; a
layer's interactions are addressed from `runtime:` **by layer id**.

- *Pro:* the boundary is unmissable, and the emitter is a projection: take `style:`, drop `runtime:`.
- *Con:* a layer's definition is split across two places. Authors currently keep `interactive:`
  next to the paint it applies to; this separates them. Round-trip editing (R6) and GUI
  authoring both get harder — every layer mutation touches two subtrees.

**Option B — Split at the top, colocation preserved via nested `runtime:` keys** **[rec]**:
top-level `style:` / `runtime:` as in A, *plus* a per-layer `runtime:` key inside each layer
that carries `interactive`, `legend`, `toggleable`, `label`. The emitter drops any `runtime:`
key at any depth — one rule, applied recursively.

- *Pro:* keeps authoring colocated (the thing people actually like about the current format),
  keeps the emitter rule trivial and *uniform*, and gives round-trip mutation a single subtree
  per concern. `x-*` extensions get the same recursive treatment, which is exactly R5's
  strip-on-emit semantics — one mechanism serves both.
- *Con:* "runtime" appears at two levels; needs a clear docs story so it doesn't read as duplication.

**Option C — No visible split; classification lives in the schema and tooling only.**
Keep the flat format; `mlym eject` knows what erases.

- *Pro:* zero migration.
- *Con:* rejected by the direction doc's own reasoning — the boundary must be visible in the
  file, not just in documentation, or the eject guarantee is a footnote users discover at
  compile time.

**Sub-decision, unavoidable under any option:** `config:` must be cut. Recommendation:
`center`/`zoom`/`pitch`/`bearing`/`mapStyle` move to `style:` (as `style.camera` or hoisted —
see V2-D3); everything else in today's `config:` becomes `runtime.map:`.

### V2-D2 — GeoJSON-canonical sources (the old D6)

Carried verbatim from the Phase-5 draft, now decided in this session. Three levels:

- **Level 1 — additive:** GeoJSON accepted everywhere alongside the invented shapes. Cheap,
  backward compatible, leaves two ways to author everything.
- **Level 2 — GeoJSON canonical, invented shapes are documented sugar that normalizes to it** **[rec]**.
  `location:`/`locations:`/`region:`/`route:` survive as shorthand with their expansion shown;
  internally everything becomes `Feature`/`FeatureCollection` immediately after parse. Docs,
  JSON Schema, and `llms.txt` present the GeoJSON form as canonical.
- **Level 3 — GeoJSON only:** sugar removed with `mlym migrate`. Cleanest contract, real
  migration cost.

Recommendation is Level 2 because it is the only level consistent with R9 (no flag-day breaks)
*and* with the agent-affordance work already shipped — one canonical form to generate against,
without invalidating existing content collections. Level 3 remains reachable later as a
deprecation riding the same v2 machinery.

**Rider decisions gated on this** (already filed): `ml-lc5.2` real RFC 7946 validation of
inline `source.data`; `ml-lc5.3` altitude `[lng, lat, alt]` policy; `ml-lc5.4` popup
`property:` dotted-path semantics.

### V2-D3 — Naming

Three known offenders:

1. **`mapStyle` vs the spec's `style`.** Under a `style:` top-level section, `mapStyle`
   becomes actively confusing (`style.mapStyle`). **[rec]** rename to `basemap:` — it says
   what it is (the style being merged into), and avoids colliding with both the section name
   and the existing container-CSS `style:` key.
2. **Container `style:` (inline CSS)** now collides with the `style:` section outright.
   **[rec]** move to `runtime.container.style` as part of V2-D1.
3. **Hoisted `center`/`zoom`.** Today they sit under `config:`; the spec has them at root.
   Decide: hoist to `style:` root (spec-shaped) or group under `style.camera:` (readable).
   **[rec]** spec-shaped — v2's whole claim is that the erasable half *is* the spec.

### V2-D4 — `state:` and the expression DSL

The parameterization note verified that MapLibre has a **spec-native `state` root property
plus a `global-state` expression**, settable at runtime via `setGlobalStateProperty`. That
produces a clean and slightly surprising classification:

- **`state:` values erase** — they are a style-spec root property. `state:` belongs in `style:`.
- **Parameter *metadata* does not.** The spec's `state` carries defaults only: no label, no
  range, no type. Any control UI needs that metadata elsewhere.

**Decision:** where does parameter metadata live? **[rec]** `runtime.parameters:` keyed by
state name (`label`, `type`, `min`, `max`, `step`, `default`) — the direction doc already
assigns this boundary ("the library owns parameter schemas; apps own presentation"), and it
falls out naturally from V2-D1 Option B.

**Decision:** the DSL surface. Constraint is already fixed by the direction doc — *surface
syntax over MapLibre expressions, never new semantics*. Open: sigil conventions (`@state` /
`{property}`), `let:` scoping, and whether v2 ships the DSL at all or only reserves the
grammar. **[rec]** reserve the grammar in v2, ship the desugarer behind it later — the DSL is
the least-evidenced item in the whole arc and the NYC demo that motivates it is explicitly a
*following* arc gated on a performance spike.

### V2-D5 — Tangram-heritage sugar

Layer inheritance, compound layers, real-world units, `extends:`. The direction doc folds
these into the v2 definition rather than a separate track. All four are sugar by construction
(they must compile to spec). **Decision needed:** which are *defined* in v2 versus merely
*not foreclosed* by it.

**[rec]** define `extends:` / layer inheritance in v2 (it changes the document shape, so it
must be settled before the schema freezes) and defer compound layers + real-world units to a
later minor (they are expansions the emitter can add without a format change). R11 applies:
check each against both consumers before committing.

### V2-D6 — Version declaration and staging

Mechanism is already **decided** (D5, RFC accepted): optional `version:` field **plus**
versioned `$schema` URLs; parser reads current + previous with shims; one-minor-cycle
deprecation window. What this session must add:

- **Staging order.** v2 arrives in stages. Which stage ships in which minor, and what the
  v1→v2 shim covers at each step.
- **`mlym migrate` scope** (`ml-axa.3`) — mechanical for the split and the renames; the
  GeoJSON sugar is *not* migrated under Level 2 (it stays legal).
- **Does 0.5.0 itself carry a format change?** **[rec] no.** 0.5.0 ships the emitter and the
  registry against the *defined* v2 shape but reading v1 documents, with v2 parsing landing in
  0.6.0 alongside the write seam. This keeps 0.5.0 shippable and gives the definition a
  release cycle of soak time before users must act on it.

---

## Part 3 — What the session unblocks

| Bead | Waiting on |
|---|---|
| `ml-0u9` (emitter, R4) | V2-D1 (what the emitter projects), V2-D3 (`basemap:` merge target), V2-D4 (`state:` passthrough) |
| `ml-dnu` (registry, R5) | V2-D1 Option B's recursive-strip rule — the same mechanism as `x-*` strip-on-emit |
| `ml-lc5.2/.3/.4` | V2-D2 |
| `ml-axa.*` (versioning impl) | V2-D6 staging order |
| `ml-0fg` (write seam, R6) | V2-D1 — subtree shape determines mutation API |
| `ml-cbm` (interactions, R7) | V2-D1 — where interactions live in the document |

---

## Part 4 — Carried open questions

Not for this session, recorded so they are not lost:

- Lighting minimalism, sprite naming, mobile interaction variants — resolve when their
  features leave the deferred tier.
- QuickJS-in-WASM sandbox — app-tier, opt-in, on tenant demand.
- Effects catalog and the deck backend — gated on validating the fallback contract after the
  arc lands. The ~1,350 lines in `docs/brainstorms/effects/` are **written but unrun**;
  hypothesis tier, not proof.
- `ml-a50` (D8 ratification) — independent of v2, but it touches JSON Schema strictness and
  should be settled before the emitter regenerates contract artifacts.
