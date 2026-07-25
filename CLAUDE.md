# maplibre-yaml — agent orientation

Declarative MapLibre GL web maps from YAML. pnpm monorepo: `@maplibre-yaml/core`
(schemas, parser, renderer, `<ml-map>` web component), `@maplibre-yaml/astro`
(components + content-collection integration), `@maplibre-yaml/cli` (`mlym`).
Docs site in `docs/` (Starlight).

This file is the portable orientation for any machine or fresh session. It is a
point-in-time snapshot; update it as state moves.

## Current state (as of 2026-07-24)

- Published: core 0.3.1, astro 0.3.1, cli 0.1.13. **Never depend on 0.2.0** — it
  was deprecated on npm (the issue #28 workspace-refs manifest bug).
- **0.4.0 is HELD in the open "Version Packages" PR (#51). Do not merge #51**
  until the schema-truthfulness units land — it ships as one coherent 0.4.0
  (Phase 2 JSON Schema + validation ergonomics + truthfulness + riders). Ratify
  decision D8 (JSON-Schema strict-shape) at merge time.

## Ratified direction — read first

`docs/brainstorms/2026-07-24-library-direction-requirements.md` is canonical and
supersedes earlier strategic framing. In one line: the library is the YAML
authoring layer for the MapLibre style spec — an **erasable** core that compiles
to spec-valid `style.json`, plus optional runtime packages for the experience
layer. Organizing principle = the **erasability test** (sugar → core / deviation
→ runtime package / product → app). Load-bearing drivers = document **longevity +
trust**. The format never carries executable JS, DOM selectors, or user GLSL.

- Post-train arc (one body of work): extension registry + round-trip write seam +
  `style.json` emitter + interactions package. NYC parameterization demo follows.
  Effects/deck are deferred to a validation tier (reference code in
  `docs/brainstorms/effects/` is written-but-unrun).
- Format v2 = one coherent destination (`style:`/`runtime:` split +
  GeoJSON-canonical sources + `state:`/expression-DSL + Tangram Tier-1/2 sugar),
  staged behind the accepted versioning RFC. The Phase 5 / D6 scoping session
  grows into the define-v2 session.
- Input strategy docs, absorbed with amendments: the two 2026-07-14 proposals,
  2026-07-15 ADR-001, 2026-07-24 style-parameterization.

## Active plan

`docs/plans/2026-07-08-001-feat-quality-adoption-release-train-plan.md`. Phase 0
(0.3.1 — minify, astro runtime deps, release-tag fix) SHIPPED. Phase 1
(truthfulness U3–U10) + riders (U11–U16) are next and feed #51 → 0.4.0. U4/U5
interaction units are built registry-shaped so the future interactions package is
a move, not a rewrite.

## Conventions

- Task tracking is migrating to **beads** (`bd` CLI). File new todos there, not in
  `todos/`.
- Route all runtime maplibre-gl symbol access through
  `packages/core/src/renderer/maplibre-interop.ts` (the v3–v5 ESM interop shim) —
  never import maplibre-gl symbols directly.
- `docs/public/schema/`, `docs/public/llms*.txt`, and `packages/core/schemas/` are
  build-generated (decision D7: generate-on-build, never commit).
- Two real consumers gate new capability: a client Astro project (trusted,
  build-time) and mapparty (hostile-input GUI, consumes the library). A capability
  serving only one is suspect until proven general.

## Session memory (machine-local, not in git)

Prior Claude Code session memory lives at
`~/.claude/projects/-Users-marioag-Documents-GitHub-maplibre-yaml/memory/` — it is
machine-local and does not travel with the repo. This file is the portable
substitute. For exact continuity on another machine, copy that directory to the
same path there (requires a matching username and clone path).
