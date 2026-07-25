# ADR-001: Tangram Heritage, Static Format Boundaries, and Function Handling

**Status:** accepted (design phase) · **Date:** 2026-07-14
**Scope:** `maplibre-yaml` (all packages) and `mapparty`
**Companion artifacts:** `PROPOSAL-effects-deck-interactions.md`, `PROPOSAL-function-handling.md`, `src/types.ts`, `src/util.ts`, `src/effects/*`, `src/effects-deck/*`

---

## Context

Two questions prompted this record:

1. Could elements of Mapzen's Tangram — its YAML scene format, shader-driven
   cartography, lighting, and inline functions — be subsumed into how
   `maplibre-yaml` renders?
2. How should JavaScript-like logic be expressed in an otherwise-declarative
   YAML document, given mapparty is a collaborative SaaS where documents render
   on other users' screens?

Relevant facts established during research: Mapzen shut down in January 2018;
Tangram JS is effectively dormant (still a Leaflet plugin, WebGL1-era build
targets), so adoption can only mean absorbing its *authoring model*, not its
runtime. MapLibre's style spec deliberately lacks Tangram's three defining
capabilities: inline per-feature JS, per-layer shader injection, and scene
lighting/cameras. MapLibre's only shader escape hatch is CustomLayerInterface
(author owns the entire pipeline; no tile plumbing, no picking, no label
collision). deck.gl's interleaved MapboxOverlay + luma.gl shader hooks +
LightingEffect + GPU picking close most of those gaps at the cost of a heavy
optional dependency and a version-coupling seam.

## The governing decision: the erasability test

Every feature is classified by one question — **does it erase at compile time?**

| Class | Definition | Home |
|---|---|---|
| Sugar | Compiles to plain, spec-valid `style.json`; nothing left over | `@maplibre-yaml/core` |
| Deviation | Requires shipping runtime JavaScript | optional runtime packages |
| Product | Requires a server, curation, or collaboration | mapparty |

Core's guarantee, held absolutely: *everything in a core document compiles to
pure MapLibre style spec.* No core feature may quietly require the runtime; the
moment "it mostly compiles except this one thing" ships in core, the eject
guarantee becomes a footnote.

## Decision area 1 — Tangram compatibility strategy

**Options considered:**

- **(a) Run Tangram as a renderer.** Rejected: unmaintained, Leaflet-bound,
  WebGL1-era; a dead end.
- **(b) Tangram scene-file importer.** Rejected: engines' capabilities differ
  too much for faithful conversion; best-effort importers create support burden
  and false expectations. (Precedent tooling existed only in the reverse
  direction and is abandoned.)
- **(c) Adopt Tangram's authoring ideas as a superset of our own schema that
  always compiles to `style.json`.** **Accepted.** Preserves the eject story,
  captures the ergonomics people actually miss, and frames the work as a
  compiler problem rather than a renderer problem.

**Tiering of Tangram-inspired features (accepted):**

- *Tier 1 — pure compile-time sugar, core:* nested layer inheritance with
  `["all", …]` filter composition and deep-merged draw params; compound layers
  (one YAML node → several spec layers: cased roads, point+label) with stable
  derived ids; explicit `order:` escape hatch over DFS flatten order; `global:`
  variables usable inside expressions with compile-time color math; `extends:`/
  import with build-time deep merge (mirror Mapbox v3 `imports` semantics where
  sensible in case MapLibre adopts them); real-world units (`12m` → zoom-
  interpolated px expression, latitude-anchored at compile time); zoom and
  filter shorthand (`$zoom` promotes to layer minzoom/maxzoom); build-time
  sprite/glyph pipeline (SVG list → spreet) in the Astro package.
- *Tier 2 — translatable syntax, core:* Tangram-style filter YAML, zoom-stop
  arrays, named style mixins.
- *Tier 3 — runtime deviations, quarantined:* shader effects and animation.
  Scoped as a **curated effects catalog** (parameterized, hand-written
  effects), not arbitrary user GLSL.

## Decision area 2 — Static file format and package boundaries

**Document format (accepted):** top-level split into `style:` (erasable) and
`runtime:` (plugin-claimed), so the sugar/deviation boundary is visible in the
file itself. Compiler modes make the guarantee executable: `--strict` fails if
`runtime:` exists; `--with-fallbacks` emits `style.json` with every effect
replaced by its declared static fallback; unknown runtime keys are build
errors, never silent no-ops. These two modes map 1:1 to mapparty's export
options (*Static bundle* / *Full bundle*).

**Package split (accepted):** `core` (compiler + exported extension contract,
zero runtime) · `effects` (raw-WebGL catalog, maplibre-gl peer) ·
`effects-deck` (deck-backed effects, deck peer, lazy-loaded chunk — users not
using deck never pay for it) · `interactions` (named-hook registry, popups,
events) · `astro` (glue + asset pipeline; later `/react` sibling reuses
everything below).

**Effect contract invariants (accepted; normative in `types.ts`):**

1. **Mandatory fallback.** Every effect declares `fallback()` returning plain
   spec layers (optionally with generated sprite assets), enforced at
   registration time. Fallback fidelity is release-tested via side-by-side
   visual regression.
2. **Schema is the UI.** Zod `paramsSchema` drives compiler validation,
   generated types, and mapparty's auto-generated parameter panels.
3. **Effects own nothing global**; interactivity lives in `interactions`;
   lighting is scene-scoped (`runtime.lighting`), echoing Tangram's own
   top-level `lights:`.
4. **Whole-source GeoJSON only (v1)** — no custom tile plumbing.
5. **Requirements degrade, never blank**: unmet `webgl2`/`mercatorOnly` →
   render the fallback and warn. Treated as a tested feature (low-end devices
   at community meetings are a primary mapparty scenario).

**deck.gl backend (accepted, second release):** a second backend behind the
*same* contract — `create()` may return a `DeckEffectDescriptor` instead of a
`CustomLayerInterface`. One shared interleaved `MapboxOverlay` per map; the
runtime drives the animation clock; lighting merged from the document block.
Rationale: deck's shader hooks are Tangram's `blocks:` reborn, LightingEffect
is the one capability with no MapLibre analog, and built-in picking unifies
interactions. Risks accepted with mitigations: deck×maplibre version coupling
(pinned CI matrix), globe/terrain seams (`mercatorOnly` degradation). The
fallback contract is unchanged — the eject guarantee never learns deck exists.

**Sequencing (accepted):** v1 = raw-GL `effects` + `interactions` (prove the
fallback discipline); v2 = `effects-deck` (the showstoppers). POC/marketing
surface: "Porting the Mapzen classics" — Crosshatch (`hatch-fill` flat now, lit
faces with deck), Tron (roads now, buildings with deck), Day/Night (camera via
`easeTo`, palette via globals, true lights via deck), Walkabout (pure core YAML
over native terrain — deliberately included to demonstrate zero-runtime). Label
effects: acknowledged as not portable at all.

## Decision area 3 — Function handling (JS in YAML)

**Options considered:**

- **(a) Inline JS strings, Tangram-style.** Rejected outright: stored-XSS in
  the collaborative context, and the format must mean the same thing in every
  context — so rejected for self-hosted mode too.
- **(b) DOM selectors in YAML.** Rejected: couples documents to one page's
  markup, breaks silently, injection surface.
- **(c) Named hooks + expression DSL.** **Accepted as the default.** YAML
  references symbols; JS lives in host code via `registerHandler()`;
  closed-world resolution (`--strict` fails on unregistered names unless
  declared `external: true`; mapparty resolves only platform-shipped names).
  Computed values use MapLibre expressions (reached via core sugar) and
  bounded `{{property | filter}}` templates for popup text. Built-ins
  (`popup`, `highlight`, `zoom-to-feature`, `emit` → CustomEvent) cover most
  civic interactivity with zero user JS.
- **(d) Sandboxed inline JS.** **Deferred with conditions defined now:** only
  via QuickJS-in-WASM inside a worker, capability-based API (`{feature, zoom,
  globals}` in, value out, no fetch/DOM), hard time budget; an app-tier,
  opt-in, audit-logged feature marked `requires: scripting` in the document —
  never part of the format's baseline. ShadowRealm noted as not yet shipped;
  revisit if it lands.

**Host-page interop (accepted):** CustomEvents on the map container, named
slots in the framework components, and the JS API — YAML declares *what*,
never *where in the DOM*.

## Consequences

- The open format stays portable and boring on purpose: any document's
  `style:` block opens in Maputnik and survives mapparty's disappearance.
- mapparty's product surface is constrained to UIs over the format and hosted
  execution of shipped tooling — every mapparty feature must be expressible in
  the YAML a free user can download. This is the moat-by-service-quality
  strategy made structural.
- Tangram heritage becomes a documentation and marketing asset (migration
  guide from Tangram function idioms; the classics POC page) rather than a
  compatibility liability.
- Costs accepted: maintaining fallback fidelity per effect per release;
  a deck/maplibre CI compatibility matrix; two shader codepaths (raw-GL and
  deck) behind one contract; saying no to arbitrary user GLSL in the SaaS
  indefinitely.

## Open questions (tracked, not blocking)

1. `runtime.lighting`: multiple named lights vs. exactly one directional +
   ambient (leaning minimal/Tangram-parity).
2. Sprite naming for generated fallback assets: param-derived (debuggable) vs.
   content-addressed (collision-proof) — possibly readable prefix + short hash.
3. `interactions` mobile variant block (tap vs hover) vs. hover-degrades-to-
   nothing for v1.
4. Whether a friendlier general expression language (CEL/JSONata class) is ever
   warranted beyond core sugar + templates — criteria: observed user demand,
   weighed against documentation cost.