# feat: JSON Schema Export & Agent Affordances

**Phase:** 2 of the [meta-plan](./meta-plan-stabilization-and-roadmap.md)
**Status:** Approved (sequencing confirmed by Mario)
**Depends on:** Phase 1 Workstream E (block dispatcher) and Workstream F (canonical popup format purge)

## Overview

Publish the YAML contract as machine-readable artifacts so that (a) human authors get in-editor autocomplete and validation via `yaml-language-server`, (b) CI and agents get a stable schema URL to validate against, and (c) LLMs can reliably generate valid configs. This is the single highest-leverage, lowest-cost item in the assessment: the Zod schemas already carry rich `.describe()` annotations — the work is conversion and publishing, not authoring.

## Problem Statement

The schemas exist only as Zod-in-TypeScript. A YAML author gets zero editor feedback; validation is post-hoc via the CLI. An agent generating configs has no contract to read — it must scrape docs that (until Phase 1) contained three incompatible popup formats. There is no `llms.txt`, no JSON Schema, no `$schema` convention. For a product whose artifact *is* a YAML file, this is the biggest DX gap.

## Proposed Solution

### 1. JSON Schema generation (core)

- Add `zod-to-json-schema` as a **devDependency of core** and a build step (`scripts/emit-json-schema.ts`, run in `pnpm build`) that emits per-block schemas to `packages/core/schemas/`:
  - `map.schema.json` (MapBlockSchema — the `<ml-map>`/CLI unit)
  - `scrollytelling.schema.json`
  - `root.schema.json` (pages document)
  - `any.schema.json` — a `oneOf` over the above discriminated on `type`, matching the Phase-1 `safeParseAny` dispatcher
- Ship them in the npm package (`files` + an `"./schemas/json/*"` export) so tooling can resolve them offline.
- **Known conversion limits, handled explicitly:**
  - Zod `.refine()` logic (e.g. the geojson url/data/prefetchedData guard) does not convert — the JSON Schema is necessarily *looser* than the Zod source. Document that JSON Schema is for authoring assistance; `mlym validate` (Zod) remains the source of truth. Where a refinement encodes a structural rule, mirror it structurally when cheap (e.g. `oneOf` on source key combinations).
  - The recursive `page.schema.ts` MixedBlock union already produces a 3.5 MB `.d.ts`; conversion may be similarly explosive. Emit per-block schemas (not one mega-schema) and use `$defs` + `$ref` instead of inlining. If `root.schema.json` is still unreasonable, ship map/scrollytelling first and defer root.
  - `.passthrough()` maps to `additionalProperties: true` today; when the validation-ergonomics plan flips to warn-on-unknown, regenerate with `additionalProperties: false` **plus** `patternProperties: {"^x-": {}}` to keep the extension escape hatch (see map-party note in the meta-plan).

### 2. Stable schema URLs (docs site)

- Publish each generated schema to `docs/public/schema/<version>/<block>.schema.json` plus a `latest/` alias, giving stable URLs like `https://docs.maplibre-yaml.org/schema/latest/map.schema.json`.
- Version directories align with the versioning RFC (Phase 4); until that lands, `latest/` plus the core package version is enough.
- Wire generation into the docs build so the site can never publish schemas stale relative to the core it documents.

### 3. Editor integration (zero-install for users)

- Document the `yaml-language-server` modeline convention:
  ```yaml
  # yaml-language-server: $schema=https://docs.maplibre-yaml.org/schema/latest/map.schema.json
  type: map
  ```
- Add the modeline to every template the CLI scaffolds and every config in `docs/public/configs/`.
- Document the VS Code `yaml.schemas` settings block as the no-modeline alternative. This supersedes the aspirational `docs/examples/vscode/EXTENSION_ROADMAP.md` for now — autocomplete/hover/validation come free from the Red Hat YAML extension once schemas exist; a bespoke extension is not on the roadmap.

### 4. CLI `schema` command

- `mlym schema [map|scrollytelling|root|any]` prints the JSON Schema (from the installed core package, guaranteeing version match with `mlym validate`), `--out <file>` writes it. This is the offline/agent path and the natural hook for future `migrate` tooling.

### 5. `llms.txt`

- Add `docs/public/llms.txt` (index: what the project is, canonical schema URLs, the five most instructive complete configs, pointer to the CLI validation loop) and `llms-full.txt` (concatenated schema-reference pages + canonical examples), generated at docs build time from the same sources as the human docs so they cannot drift.
- Content rules learned from the assessment: state explicitly that (a) `<ml-map src>` expects a `type: map` block, (b) the popup DSL is the tag-array form — include one complete example, (c) named sources are referenced by bare name. These were the three biggest agent-poison ambiguities.

### 6. Machine error contract (mostly exists — finish it)

- `mlym validate -f json|sarif` already returns structured `{path, message, line, column}` — after Phase 1 E it covers all block types, and after the validation-ergonomics plan the line/column fields are real. Document this loop prominently ("how to use maplibre-yaml with an AI agent": generate → `mlym validate -f json` → repair → repeat) as a docs page. That page plus the schema URL is the whole agent story, and it doubles as CI documentation.

## Testing strategy

- Snapshot tests on generated schemas (catch accidental contract changes in PR diffs — this is also a cheap early-warning system for unintended schema drift, valuable before Phase 5).
- Round-trip test: every config in `docs/public/configs/` and every CLI template validates against both the Zod source **and** the generated JSON Schema (via `ajv`) — this catches converter fidelity gaps.
- A "first-try generation" eval fixture: hand-written prompts + expected-valid outputs checked with ajv; run manually before releases (not CI-blocking).

## Out of scope

- A bespoke VS Code extension / language server.
- Strictness changes to the Zod schemas themselves → [feat-validation-ergonomics.md](./feat-validation-ergonomics.md).
- Schema version negotiation / migration tooling → [rfc-schema-versioning.md](./rfc-schema-versioning.md).

## Open questions for review

1. Do we commit the generated `.schema.json` files or generate-on-build only? (Recommend: generate-on-build, publish in package + site; committing invites drift.)
2. Should `map.schema.json` describe the *strict* shape (`additionalProperties: false` + `x-` escape) from day one, even while Zod is still passthrough? Editor UX is better with strict; recommend yes, since JSON Schema is advisory.
