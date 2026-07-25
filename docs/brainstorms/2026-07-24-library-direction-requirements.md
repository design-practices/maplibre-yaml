---
date: 2026-07-24
topic: library-direction
---

# Library Direction — Reconciled Requirements

## Summary

Adopt the erasability test as the library's organizing principle over the existing format — a spec sitting over the MapLibre style spec plus an experience layer with honest degradations — with document longevity and trust as the load-bearing drivers. The post-train arc delivers the extension registry, a round-trip write seam, the style.json emitter, and the interactions package as one body of work; format v2 is defined once and arrives in stages behind the versioning RFC; the NYC parameterization demo is the following arc.

---

## Problem Frame

Two theses collided. The ratified quality/adoption roadmap framed the library as a DX-first YAML runtime whose differentiators are the live-data layer and the Astro integration. Four newer documents — written from the far side of a mapparty sprint — reframed core as a compiler whose product is the eject guarantee plus a Tangram-heritage extension model (`docs/brainstorms/2026-07-15-tangram-style-replication.md` and companions).

Session findings that resolved the collision:

- The published core emits no `style.json` today; the renderer drives MapLibre imperatively. The compiler is additive new capability, not a relabeling.
- The style spec cannot express controls, legends, popups, live refresh, or scrollytelling. Eject can only ever cover the style layer; the experience layer needs a runtime home under any architecture.
- Sorting the shipped surface by erasability shows nothing antithetical to eject: sources, layers, expressions, camera defaults, `$ref`, and the Astro `feature_ref` system all erase; live data degrades to snapshot-on-load; interactions and chrome degrade to absence. The only truly antithetical mechanism — inline JS — was never added and is now formally prohibited.
- Two real consumers ground the evidence: a client Astro project (trusted, authored-once, build-time) and mapparty (hostile-input, GUI-round-tripped, collaborative, consuming the deprecated core 0.2.0). mapparty's entire panel surface rides unvalidated `x-map-party` passthrough blocks, its writes funnel through a hand-rolled parse→mutate→serialize seam, and it grew two independent serializers — observed demand for capabilities on nobody's roadmap.
- The effects reference implementations (`docs/brainstorms/effects/`) are ~1,350 lines of written but unrun code — hypothesis tier, not proof.

---

## Key Decisions

- **Longevity and trust are the load-bearing drivers.** They were the genesis of the project; the eject guarantee serves them directly, and its value stands independent of mapparty — YAML authoring of the style spec that outlives every tool in the chain.
- **The erasability test is adopted as the organizing principle, not a repositioning-by-fiat.** The current format is correctly understood as an erasable spec-over-the-style-spec plus an experience layer whose every feature has a sane degradation. Eject is additive: build the emitter, define degradation semantics per experience feature.
- **The eject claim is scoped honestly.** It covers the style layer (`--strict` / `--with-fallbacks` compiler modes); scrollytelling and the pages format sit outside it explicitly, and the experience layer degrades rather than ejects.
- **The 0.4.0 release train continues unchanged in scope.** The interaction units are implemented registry-shaped inside core (proto-interactions), so the later package extraction is a move, not a rewrite.
- **Extensibility resolves as: closed erasable half, claimably-open runtime half.** The erasable schema stays closed (it must compile to spec). Runtime capabilities arrive through the typed extension contract. The `x-*` convention is formalized into an extension registry — register a schema, get validation, normalization, and documented strip semantics. Eject-to-JS remains the documented floor.
- **Format v2 is one coherent destination arriving in stages.** v2 = the visible `style:`/`runtime:` split, GeoJSON-canonical sources, naming fixes, and the `state:`/expression-DSL layer, defined once; the versioning RFC's dual-parse machinery carries the staged migration. The Tangram Tier-1/2 sugar (layer inheritance, compound layers, real-world units, `extends:`) folds into the v2 definition rather than running as its own track. Phase 5's scoping session grows into the define-v2 session.
- **The expression DSL is surface syntax over MapLibre expressions, never new semantics** (carried from the parameterization note). The library owns parameter schemas (type, range, label, default); apps own presentation.
- **Live data keeps its core seat and its priority until the v2 reorganization.** No early extraction, no demotion; the perf plan's hardening and lazy-loading continue and double as extraction preparation.
- **The post-train arc is consolidation-with-proof.** Extension registry + round-trip write seam + emitter + interactions package as one arc — every item serves both real consumers, and together they meet the proof criteria. The NYC parameterization demo is the following arc, gated on its step-0 performance spike.
- **Effects are demoted from proof to validation tier.** One or two effects validate the fallback contract after the arc lands; the deck backend and the broader catalog wait. The function-handling prohibitions (no inline JS, no `eval`/`new Function`, no DOM selectors in documents, no user GLSL in the SaaS) are adopted as format law now.

---

## Requirements

**Direction and identity**

- R1. The library's public identity is the YAML authoring layer for MapLibre: an erasable core that compiles to spec-valid `style.json`, plus optional runtime packages for the experience layer.
- R2. Every format feature is classified by the erasability test (sugar / deviation / product), and the classification is visible in documentation.
- R3. The format never carries executable JavaScript, DOM selectors, or user GLSL; logic is named hooks and declarative expressions only.

**Post-train arc**

- R4. An emitter compiles the erasable subset of a document to standalone, spec-valid `style.json`, including compile-time basemap merge, with `--strict` and `--with-fallbacks` modes.
- R5. An extension registry lets a consumer register a schema for an `x-*` namespace and receive validation, declared normalization rules, and strip-on-emit semantics; `x-map-party` (schema documented in this session) is its first customer.
- R6. A round-trip write seam (parse → mutate → serialize, comment- and format-preserving) becomes a supported library capability, replacing consumer-rolled serializers.
- R7. Interactions ship as a registry-backed package (or extraction-ready core module) covering popup, highlight, zoom-to-feature, and emit, with closed-world handler resolution under strict mode.

**Format v2**

- R8. v2 is specified in a single scoping session (grown from Phase 5/D6) covering the split format, GeoJSON-canonical sources, naming, `state:`/DSL, and the Tangram-heritage sugar; migration rides the accepted versioning RFC.
- R9. Deprecations and removals ride the v2 machinery; no flag-day breaks for the published line's users.

**Consumers**

- R10. mapparty upgrades off deprecated core 0.2.0 to the current stable line as a near-term action.
- R11. New capabilities are checked against both real consumers (client Astro project; mapparty); a capability serving only one is flagged for scrutiny before it lands in the library.

---

## Success Criteria

- A real client-project document compiles to a `style.json` that opens correctly in Maputnik and renders in vanilla `maplibre-gl` — the longevity proof.
- Interactions work end-to-end through the registry on a compiled map — the event-handling proof Mario named fundamental.
- mapparty's `x-map-party` surface validates through the registry with its normalization rules declared, and its two serializers collapse onto the library's write seam.
- The NYC parameterization demo (following arc) demonstrates `state:`-driven scenarios on the published static path, gated on the step-0 citywide performance spike.

---

## Scope Boundaries

**Deferred for later**

- The deck backend (`effects-deck`) and the broader effects catalog — until the fallback contract is validated on the raw-GL path.
- The QuickJS-in-WASM sandbox — conditions defined in the function-handling proposal; app-tier, opt-in, on tenant demand.
- A general expression language beyond DSL-desugars-to-MapLibre-expressions — on evidence of need.
- Early extraction of the live-data layer or the renderer — rides the v2 reorganization.
- Label/text effects — acknowledged as not portable.

**Outside this product's identity**

- Inline JavaScript, `eval`-class mechanisms, and DOM selectors in documents — never, in any trust context.
- Running or importing Tangram itself — the heritage is authoring ideas, not runtime or converter.
- App capabilities not expressible in the open format — mapparty may not gain features a free user's downloaded YAML cannot express.
- A registry/plugin mechanism for the *erasable* schema — the closed spec-bound half is the product.

---

## Dependencies / Assumptions

- The versioning RFC (accepted) is implemented in time to carry v2's staged migration.
- MapLibre has not shipped style `imports`; the emitter performs compile-time basemap merge, and revisits if `imports` lands.
- The effects reference code is unvalidated; all effects sequencing assumes a validation pass before commitments.
- The four input documents are absorbed with amendments by this document: ADR-001's decisions stand except its v1 sequencing (effects demoted from proof tier); the function-handling and parameterization decisions are adopted as recorded; the effects/interactions proposal's package map remains the terminal shape, reached via the post-train arc rather than effects-first.
- Issue tracking is migrating to beads; new action items sync there rather than `todos/`.

---

## Outstanding Questions

**Resolve before planning the next arc**

- The release arc itself: PR #47's merge triggered a Version Packages PR proposing 0.4.0, but the release shape (what ships as 0.4.0, what waits for the arc's capabilities) needs rethinking against this direction before that PR merges.
- D8 (JSON-Schema strict-shape interpretation) — flagged in PR #47, still unratified.

**Deferred to planning**

- Registry API shape, write-seam API shape, emitter architecture — the arc's ce-plan.
- Sigil conventions (`@` state / `{}` properties), `let:` scoping surface, and the DSL grammar — the define-v2 session.
- Carried open questions from the input documents (lighting minimalism, sprite naming, mobile interaction variants) — resolved when their features leave the deferred tier.
