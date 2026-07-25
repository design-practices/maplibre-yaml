# Proposal: `@maplibre-yaml/effects`, `@maplibre-yaml/effects-deck`, `@maplibre-yaml/interactions`

**Status:** draft v0.2 · **Scope:** runtime extension packages sitting outside `@maplibre-yaml/core`

---

## 1. Motivation and guiding invariant

`maplibre-yaml` core is a compiler: YAML in, spec-valid `style.json` out, zero runtime.
Some features people loved in Tangram — shader-driven cartography, animation, scene
lighting, click behavior — cannot exist inside the MapLibre style spec. Rather than
letting those capabilities erode core's guarantee, they are quarantined into optional
runtime packages governed by one bright-line test:

> **Does the feature erase at compile time?**
> If a YAML construct compiles to plain spec-valid `style.json` with nothing left
> over, it belongs in core (sugar). If it requires shipping runtime JavaScript, it
> belongs in a runtime package (deviation). If it requires a server, curation, or
> collaboration, it belongs in the app.

The guarantee this preserves, stated once and enforced everywhere:

> *Everything in a core document compiles to pure MapLibre style spec.*

## 2. Document format: the visible boundary

The YAML document is split into two top-level sections so the boundary is visible in
the file itself, not just in documentation:

```yaml
style:            # erases — pure spec output
  global:
    color: { primary: '#2b6cb0', ink: '#1a202c' }
  layers:
    parks:
      data: ./parks.geojson
      draw: { fill: { color: $color.primary } }

runtime:          # requires plugins — declared, inspectable
  effects:
    harbor:  { layer: water,  type: animated-water, speed: 0.5 }
    study:   { layer: parcels, type: hatch-fill, angle: 45, cross: true }
  interactions:
    parks:   { on_click: { popup: "{{name}} — {{acres}} acres" } }
  lighting:        # scene-scoped, deck-backed (see §5)
    sun: { type: directional, azimuth: 140, altitude: 35, intensity: 1.0 }
```

Compiler behavior:

- `--strict` — emits only the `style` block; **fails the build** if `runtime` exists.
- `--with-fallbacks` — emits `style.json` with every effect replaced by its declared
  static fallback (see §4). Interactions are dropped (they have no visual footprint).
- default — emits `style.json` plus a runtime manifest consumed by the client glue.
- An unhandled `runtime` key (no registered plugin claims it) is a **build error**,
  never a silent no-op. Core exports the extension contract; plugins claim keys.

These flags are the eject guarantee in executable form, and they map 1:1 to the
app's export options (§7).

## 3. Package map

| Package | Contents | Runtime deps | Ships GLSL/JS to client |
|---|---|---|---|
| `@maplibre-yaml/core` | parser, validator, compiler, extension contract | none | no |
| `@maplibre-yaml/effects` | `EffectDefinition` registry + curated raw-WebGL effects | maplibre-gl (peer) | yes |
| `@maplibre-yaml/effects-deck` | deck-backed effects (3D, lighting, trips) | deck.gl (peer) | yes, lazy chunk |
| `@maplibre-yaml/interactions` | named-hook registry, popups, events | maplibre-gl (peer) | yes |
| `@maplibre-yaml/astro` | Astro component, build glue, sprite/glyph pipeline | astro | glue only |

Design consequences:

- Core defines and exports the **typed extension contract**; it implements no plugin.
  Core tokenizes documents into `style` (erasable) and `runtime` (claimed by plugins)
  and refuses unknown runtime keys.
- `effects` stays deck-free. deck-backed effects live in `effects-deck` with deck as
  a peer dependency; the runtime glue dynamically imports the deck chunk only when a
  document actually declares a deck-backed effect. A user hatching parcels never
  pays deck's bundle cost.
- A `/react` sibling of the Astro package can later reuse everything below the glue.

## 4. The effect contract (summary — see `src/types.ts` for the normative version)

```ts
interface EffectDefinition<P> {
  type: string;                    // 'flow-lines' — the YAML effect.type
  description: string;             // surfaced in the app catalog
  geometry: EffectGeometry[];      // 'point' | 'line' | 'polygon' — filters the catalog
  paramsSchema: ZodType<P>;        // validation + generated types + generated UI
  ui?: ParamUIHints;               // presentational hints for the parameter panel
  requirements?: { webgl2?: boolean; mercatorOnly?: boolean };
  create(params: P, ctx: EffectContext): CustomLayerInterface | DeckEffectDescriptor;
  fallback(params: P, globals): FallbackResult;   // REQUIRED — see below
}
```

Non-negotiables encoded in the contract:

1. **Mandatory fallback.** Every effect declares its static degradation as plain
   spec layers, enforced at registration time (a registered effect without a
   `fallback` function throws). `fallback()` runs at compile time in Node — no
   WebGL, no map, params and globals only. It may request generated sprite assets
   (`SpriteRequest`: deterministic SVG → rasterized by the build pipeline via
   spreet and merged into the project sprite sheet), which is how pattern-style
   fallbacks work (e.g. hatch → `fill-pattern`).
2. **The schema is the UI.** `paramsSchema` is a real Zod schema; the app generates
   parameter panels from it. One schema yields compiler validation, TypeScript
   types, and the control panel.
3. **Effects own nothing global.** An effect receives a resolved data source and a
   context; it may not touch the style, other layers, or the DOM. Interactivity
   belongs to `interactions`; lighting is scene-scoped (§5).
4. **Whole-source only (v1).** Effects operate on fully loaded GeoJSON. Custom
   layers don't participate in MapLibre's tile lifecycle, and reimplementing tile
   management is explicitly out of scope.
5. **Degradation, never blankness.** If `requirements` are unmet at runtime (no
   WebGL2; globe projection for a `mercatorOnly` effect), the runtime renders
   `fallback()` and warns. Requirement failure is a tested feature, not an error
   state.

Reference implementations shipped with this proposal:

- `effects/flow-lines.ts` — **animated** (direction dashes for sewers, one-ways,
  bus routes). Near-lossless fallback: static `line-dasharray` with identical
  color/width/rhythm; only motion is lost.
- `effects/hatch-fill.ts` — **static shader** (screen-aligned planner's
  cross-hatch). Lossy-but-faithful fallback exercising the sprite path: generated
  SVG hatch tile → `fill-pattern`. Degradation is honest (pattern scales with zoom
  instead of staying screen-fixed) but reads correctly.

Third-party path: implement `EffectDefinition`, call `registerEffect()`, publish as
`maplibre-yaml-effect-<name>` or PR into the curated set. This is how "encouraging
custom layer creation" becomes a concrete contribution route.

## 5. The deck.gl backend

### Why

Three deck capabilities close the gaps raw custom layers can't:

1. **Shader hooks ≈ Tangram `blocks:`.** deck layers expose luma.gl injection
   points (`DECKGL_FILTER_COLOR`, `DECKGL_FILTER_GL_POSITION`, `DECKGL_FILTER_SIZE`)
   and a `LayerExtension` system for packaging injections. Tessellation, extrusion,
   normals, and the render loop are deck's problem; the effect author writes a
   fragment.
2. **Scene lighting exists.** `LightingEffect` (ambient + directional + point
   lights, per-layer materials, real per-face normals on extrusions) — the one
   Tangram capability with no MapLibre analog. Caveat: lights affect only deck
   layers; a "lit" map replaces MapLibre `fill-extrusion` with deck geometry rather
   than augmenting it.
3. **GPU picking is built in.** `onHover`/`onClick` with the feature object — which
   lets `interactions` work uniformly across effect-styled layers without invisible
   companion-layer hacks.

### Mechanics

- Integration via `@deck.gl/mapbox` `MapboxOverlay` in **interleaved** mode: deck
  renders into MapLibre's WebGL context, participates in the depth buffer, and
  layers can be positioned in the stack via `beforeId` — the compiler's order
  resolution keeps working and labels render above effects. (Overlaid mode floats
  everything above labels; wrong default for basemap-integrated effects.)
- **Exactly one shared overlay per map.** The runtime hosts it and routes every
  deck-backed effect's layers into it. One overlay, many layers.
- Deck-backed effects return a `DeckEffectDescriptor` from `create()`:

  ```ts
  interface DeckEffectDescriptor {
    backend: 'deck';
    animate?: boolean;                    // runtime drives a clock if true
    getLayers(clock: number): unknown[];  // deck Layer instances (opaque to core)
    getEffects?(): unknown[];             // deck Effect instances (lighting etc.)
  }
  ```

  For `animate: true`, the shared runtime re-evaluates `getLayers(clock)` on a
  rAF-driven clock and calls `overlay.setProps({ layers })` — the standard deck
  animation pattern, centralized so effects never own their own loop.
- **Lighting is scene-scoped**, mirroring Tangram's own top-level `lights:` block.
  The document declares `runtime.lighting:`; the runtime builds one merged
  `LightingEffect`. Per-effect `getEffects()` contributions are allowed but the
  document block wins — lighting is honest about being global.
- **Known seams**, encoded as requirements: interleaving couples deck/maplibre
  version pairs (pin a CI compatibility matrix — cheap insurance); globe projection
  and terrain-draping interplay are limited, so deck-backed effects carry
  `mercatorOnly: true` and degrade to `fallback()` under globe. The contract
  absorbs deck without modifying its guarantees.
- **The fallback contract is untouched.** Whether raw-GL or deck-backed,
  `fallback()` returns spec layers. Tron buildings degrade to plain
  `fill-extrusion`; the lit crosshatch city degrades to the sprite pattern. The
  eject guarantee never learns deck exists.

Reference implementation: `effects-deck/tron-buildings.ts` — extruded buildings
with an animated emissive grid via a `LayerExtension` color injection; fallback is
a height-ramped `fill-extrusion`.

### Ceiling change

Raw-GL effects cover 2D shader cartography. The deck backend raises the deviation
tier's ceiling to essentially all of Tangram's showcase except label effects:

| Tangram classic | Raw-GL effects | With deck backend |
|---|---|---|
| Crosshatch (flat) | ✅ `hatch-fill` | ✅ |
| Crosshatch (lit faces) | ❌ no normals | ✅ lit deck extrusions |
| Tron roads / land | ✅ `flow-lines` cousins | ✅ |
| Tron buildings | ❌ weeks of extrusion work | ✅ `SolidPolygonLayer` + color hook |
| Day/Night lighting | ❌ (palette animation only) | ✅ animated `LightingEffect` |
| Walkabout / terrain | n/a — pure core YAML (native MapLibre terrain/hillshade) | n/a |
| Label/text effects | ❌ | ❌ |

## 6. `@maplibre-yaml/interactions`

Same architectural shape as effects, different domain. Handlers resolve through a
**named registry** — YAML references a symbol, JavaScript lives in code (see the
companion proposal, *Function Handling in YAML Documents*, for the trust model).

Built-ins covering the majority of civic-map interactivity with zero user JS:

```yaml
runtime:
  interactions:
    parcels:
      on_click:  { popup: "{{address}}\nAssessed: {{assessed_value}}" }
      on_hover:  { highlight: { color: $color.primary, opacity: 0.25 } }
    schools:
      on_click:  { zoom-to-feature: { padding: 40, maxZoom: 16 } }
    districts:
      on_click:  { emit: district-selected }   # CustomEvent for host-page JS
```

- `popup` — template strings using `{{property}}` interpolation (the expression
  syntax, not JS). Covers most real use.
- `highlight` — feature-state driven hover styling.
- `zoom-to-feature`, `emit` (dispatches a `CustomEvent` on the map container — the
  sanctioned host-page integration point; no DOM selectors in YAML, ever).
- `registerHandler(name, fn)` — host apps add named handlers; documents reference
  them by name. Unknown handler names are build errors under `--strict` unless
  declared `external: true` (the document promises the host registers it).

Deck-backed layers route their native picking into the same handler registry, so a
`popup` behaves identically on a plain fill layer and a Tron building.

## 7. App surfaces (mapparty)

The discipline: **the app never gains a capability that isn't expressible in the
open format.** Every feature below is a UI over YAML the library compiles, or
hosted execution of tooling the library ships.

- **Effects picker.** Generic schema→form renderer over `paramsSchema` + `ui`
  hints. Catalog filtered by the selected layer's geometry (`geometry` field).
  Live preview on the shared map. What is written to the collaborative document is
  the YAML `runtime.effects` block — the UI is a view over the format, never a
  private representation.
- **Interactions builder.** Per-layer panel ("when clicked → popup / zoom /
  nothing"); popup template editor offers the layer's actual feature properties as
  insertable chips (known from GeoJSON introspection at upload).
- **Lighting panel** (deck maps only): sun azimuth/altitude sliders writing
  `runtime.lighting`; a time-of-day scrubber is the Day/Night demo as a product
  feature.
- **Loading & device honesty.** Documents with deck effects lazy-load the deck
  chunk (show an "enhanced rendering" indicator). Requirement-check → fallback is
  a tested path: "this device shows the simplified version" is a feature, and it
  matters for the low-end-tablet-at-a-community-meeting scenario.
- **Export.** "Download map" exposes exactly the two compiler modes:
  - *Static bundle* — `--with-fallbacks` style.json + PMTiles + minimal HTML.
    Works forever, no mapparty, no JS runtime.
  - *Full bundle* — adds the MIT runtime packages so effects/interactions survive.
- **Theme system** (core, listed for completeness): design.* gallery publishes
  base themes; documents carry `extends:` + overrides; the app shows a theme
  switcher and a "customized properties" diff — overrides *are* the diff.

## 8. Proof-of-concept plan: porting the Mapzen classics

Launch page: **"Porting the Mapzen classics"** — each demo shown beside its
`--with-fallbacks` static export, doing triple duty (architecture proof, homage the
target audience recognizes, live demonstration that the eject guarantee survives
the fancy stuff).

1. **Crosshatch** — `hatch-fill` (raw-GL, v1) for the flat aesthetic; lit building
   faces via `effects-deck` (v2). ~85% of the look at ~10% of the effort; the
   missing 15% (per-face lighting) arrives with the deck backend.
2. **Tron** — `flow-lines`/glow-line cousins for roads (raw-GL, v1); animated
   emissive buildings via `tron-buildings` (deck, v2). Skip nothing.
3. **Day/Night** — camera loops are plain `easeTo` (no effects package needed);
   palette animation via global color tokens is core+app; true light animation is
   the deck `LightingEffect` scrubber.
4. **Walkabout/terrain** — pure core YAML over native MapLibre terrain/hillshade.
   Deliberately included: one classic rebuilt with **zero runtime** demonstrates
   the sugar/deviation boundary better than prose.

## 9. Release sequencing & risks

1. **v1 — `effects` (raw-GL) + `interactions`.** Prove the fallback discipline and
   the schema→UI pipeline on 3–5 curated effects. Small surface, no deck coupling.
2. **v2 — `effects-deck`.** Ships the showstoppers once the contract is proven.
   Prereq: deck/maplibre version-matrix CI.
3. Ongoing: docs as compiler output — every example in the docs is generated by the
   actual compiler in CI so documentation cannot drift; before/after YAML→JSON
   pairs double as test fixtures.

Risks, honestly:

- **Interleaved-mode fragility** (deck×maplibre version coupling; globe/terrain
  seams). Mitigation: pinned peer ranges, CI matrix, `mercatorOnly` degradation.
- **Fallback fidelity drift** — an effect evolves, its fallback doesn't. Mitigation:
  visual regression tests render effect vs fallback side by side per release.
- **Scope creep toward arbitrary GLSL.** User-authored shader `blocks:` remain a
  possible "pro mode" for self-hosted use only; never in the SaaS (GPU hangs,
  runtime compile errors on collaborators' machines). Not in v1 or v2.
- **Bundle weight.** deck stays a lazy, peer-declared chunk; measure and publish
  the numbers.

## 10. Open questions

- Should `runtime.lighting` accept multiple named lights in v2, or exactly one
  directional + ambient (Tangram-parity minimal)? Leaning minimal.
- `FallbackResult.sprites` naming: content-addressed hashes vs human-readable
  param-derived names (current draft). Param-derived is debuggable; hashing avoids
  collisions. Possibly both: readable prefix + short hash.
- Does `interactions` need a `mobile:` variant block (tap vs hover divergence), or
  is hover-degrades-to-nothing acceptable for v1?