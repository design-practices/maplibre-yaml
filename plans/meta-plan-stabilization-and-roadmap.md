# Meta-Plan: Stabilization Before Schema Evolution

**Status:** Active — decisions D1–D5 recorded; Phase 1 in progress
**Date:** 2026-07-04 (decisions D2–D5 confirmed by Mario on review)
**Supersedes:** nothing — sits above the individual plans in this directory and sequences them.

## Overview

A full assessment of the three packages (core 0.2.2, astro 0.2.1, cli 0.1.12), the docs site, and the existing plans was conducted on 2026-07-04. This document codifies the findings and the resulting sequencing decision:

> **Everything the packages currently promise must actually work before we begin new schema work. The destination after stabilization is explicit GeoJSON conformance in the schema.** — Mario, 2026-07-04

## Assessment summary (what the deep-read found)

The full findings live in the individual plans; this is the condensed version.

**What the product actually is.** The differentiated value is not "YAML instead of JavaScript" — it is (a) the **declarative runtime data layer** (fetch/cache/ETag/retry, polling with merge strategies, SSE/WebSocket streaming, declarative popups/hover) and (b) the **Astro content-collection integration** (`feature_ref`, entry builders), which is the most mature and best-tested part of the repo. Raw MapLibre offers neither. The docs currently market the commodity part and under-demonstrate the differentiated part.

**Shipped-but-broken (verified in code):**
1. Global config inheritance never reaches the runtime: `resolveMapConfig` is exported and tested but uncalled in any render path; astro builders hardcode `zoom ?? 12` so `defaultZoom` cannot take effect (todos `001`, `002`).
2. The unpkg/CDN entry (`packages/core/register.js`) re-exports the **Node build** (bare `yaml`/`zod`/`maplibre-gl` imports); the purpose-built `register.browser.js` is orphaned build output.
3. `controls:` and `legend:` YAML validates but renders nothing — `MapRenderer` never calls `addControls()`/`buildLegend()`; `<ml-map>` drops both keys.
4. Scrollytelling/content/mixed/pages schemas exist in core but **core renders none of them** (only the Astro `<Scrollytelling>` component does).
5. The CLI breaks its own scaffold: `validate`/`preview` only parse `type: map`, so the story template's advertised next step fails; the preview server pins `core@0.1.2` from esm.sh.
6. The first-touch docs (package READMEs, `installation.mdx`, `docs/patterns/`) contain non-existent imports, a popup format that was never the schema (three incompatible popup variants exist across the repo), and broken sidebar links.

**Structural gaps (no existing plan covers them):**
- No YAML schema versioning/migration strategy — the core product is a stable authored artifact with no `version:` field or deprecation policy.
- No machine-readable schema (no JSON Schema export, no `llms.txt`, no editor autocomplete) despite validation being the flagship claim.
- Validation is half-kept: line/column promised but never populated; plain `z.union` for layers gives useless errors; `.passthrough()` everywhere means property typos are silently accepted.
- No bundle/perf budget; the live-data machinery ships unconditionally; docs claim "~165KB" vs a 537KB unminified browser bundle.
- Two of the three docs in `plans/` describe already-shipped work; `feat-update-schema.md` is ~90% a spec for a different product (map-party) and assumes a diff-based renderer that does not exist.

**Strengths to protect:** release engineering (changesets, OIDC publish, failure-driven verify scripts), the security posture of build-time file loading, the `<ml-map>` in-DOM error card, the data layer's conditional-request/backoff design, and the feature-refs plan/implementation discipline.

## Sequence

| Phase | Plan document | Goal | Gate to next phase |
|-------|---------------|------|--------------------|
| 1 | [fix-shipped-but-broken.md](./fix-shipped-but-broken.md) | Every documented feature works or is explicitly re-scoped | All Phase-1 acceptance criteria green; todos 001/002 closed |
| 2 | [feat-json-schema-and-agent-affordances.md](./feat-json-schema-and-agent-affordances.md) | Machine-readable schema contract for editors, CI, and agents | Published JSON Schema + `mlym schema`; docs carry `llms.txt` |
| 2 (parallel) | [feat-validation-ergonomics.md](./feat-validation-ergonomics.md) | Validation delivers what it promises (positions, typo detection, good union errors) | Warn-mode unknown-key detection shipping; line/col in errors |
| 3 | [docs-positioning-and-examples.md](./docs-positioning-and-examples.md) | Honest positioning + runnable examples of the differentiators | "Why / when not" page live; live-data + scrollytelling examples run |
| 4 | [rfc-schema-versioning.md](./rfc-schema-versioning.md) | Decide how authored YAML evolves without breaking users | Versioning decision recorded; deprecation policy documented |
| 5 | [feat-geojson-schema-alignment.md](./feat-geojson-schema-alignment.md) | **The destination:** schema conforms to GeoJSON explicitly | Scoped with Mario; implementation plan written against v-policy from Phase 4 |
| parallel | [perf-bundle-and-lazy-loading.md](./perf-bundle-and-lazy-loading.md) | Bundle budget + lazy live-data machinery; data-layer hygiene | Can run alongside Phases 2–4; no schema coupling |

Rationale for the order:
- Phase 1 first because several *documented, released* behaviors are broken; new features built on top would compound the trust debt.
- Phase 2 before Phase 5 because the GeoJSON alignment will change the schema surface — we want the JSON-Schema publishing pipeline and the strict/warn validation machinery in place *before* the migration, so the new schema ships with autocomplete, machine validation, and deprecation warnings on day one.
- Phase 4 before Phase 5 because GeoJSON alignment is the first change big enough to need a real versioning/deprecation story.
- Phase 3 can start any time after Phase 1; it needs no code.

## Explicitly deferred (not scheduled)

- **Feature-refs V2 candidates** (multi-feature refs, compound matchers, filter expressions, PMTiles) — the V2 list in `feat-geojson-feature-references-v1.md` remains the backlog; several items intersect with GeoJSON alignment and should be re-triaged inside Phase 5 scoping.
- **map-party renderer hooks** (`onStyleReconciled`, `x-map-party` extension stripping, diff-based reconciliation) from `feat-update-schema.md` — unbuilt, assumes an architecture we don't have. Revisit only after Phase 5; the `x-*` extension-prefix question is noted in the validation-ergonomics plan so strict mode doesn't foreclose it.
- **Core-rendered scrollytelling** — Phase 1 re-scopes scrollytelling as Astro-delivered (see decision D3 below); a core renderer is a possible future feature, not a bug fix.
- **Archival:** `feat-geojson-feature-references-v1.md` and `feat-global-config-inheritance.md` describe shipped work; once todos 001/002 close, both should be moved to a `plans/shipped/` subdirectory. `feat-update-schema.md` should be moved out of this repo's plans (it is a map-party spec) or renamed to make its provenance clear.

## Decision log

| # | Decision | Status |
|---|----------|--------|
| D1 | Stabilize before new schema work; GeoJSON alignment is the post-stabilization destination | **Decided** (Mario, 2026-07-04) |
| D2 | `controls:`/`legend:` — make them work (wire existing managers into the render path) rather than remove from schema | **Decided** (Mario) |
| D3 | Scrollytelling/content/mixed/pages — document as Astro-delivered for now; core schemas stay but docs/errors say where each block type renders | **Decided** (Mario) |
| D4 | Strict validation rollout: warn-by-default on unknown keys, error under `--strict`, full strict at next minor after GeoJSON alignment | **Decided** (Mario) |
| D5 | Schema versioning mechanism | **Decided** (Mario): RFC option B + C — optional `version:` field plus versioned `$schema` URLs; parser reads current + previous version with shims; one-minor-cycle deprecation window confirmed |
| D6 | Scope of GeoJSON conformance (authoring surface vs internal representation vs both; fate of `location`/`region`/`route` sugar) | Open questions in Phase-5 scoping doc; **needs discussion** |
| D7 | JSON Schema artifacts: generate-on-build, never committed | **Decided** (Mario, 2026-07-05) |
| D8 | Published JSON Schema describes the strict shape (`additionalProperties: false` + `x-*` escape) even while Zod runtime is warn-only | **Decided** (Mario, 2026-07-05) |
| D9 | `mlym validate` promotes warnings to errors when `CI=true` (overridable with `--no-strict`) | **Decided** (Mario, 2026-07-05) |
| D10 | Todo 035: make layer-level `{$ref}` into root-level `sources:` validate and resolve (rather than dropping root sources or deferring) | **Decided** (Mario, 2026-07-05) |
| D11 | Browser validation warnings are console-only (no on-map badge) | Default applied (validation plan) |

## Success criteria for the stabilization arc (Phases 1–4)

- A new user can follow any getting-started path (CDN script tag, npm + bundler, Astro) verbatim and see a working map.
- Every YAML key that validates either does something or emits a warning saying where it applies.
- `mlym validate` accepts every block type the schemas define, with line/column positions, in human/json/sarif formats.
- An LLM given only the published JSON Schema + `llms.txt` can generate a valid config for each block type on the first try.
- The docs state what the library is for, what it is not for, and demonstrate live data and scrollytelling in runnable examples.
- A written policy exists for how the YAML contract may change.
