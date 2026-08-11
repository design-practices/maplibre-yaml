---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
type: docs
title: "docs: v0.6.0 pre-publish documentation pass"
date: 2026-08-11
---

# docs: v0.6.0 pre-publish documentation pass

**Epic:** ml-alp (Docs positioning & examples) — file these units as ml-alp children · **Release gate:** must land before the 0.6.0 release PR (#78) merges.

## Summary

A docs audit found the docs do **not** reflect v0.6.0's headline capabilities: format v2 has zero user docs, and the interactions + eject runtime surface (`attachInteractions`, `projectStyle`) is undocumented. This plan closes **four capability gaps** — v2 format, interactions + eject, stale integration pages, and no vanilla example — delivered as **five units** (the interactions gap spans the guide **U2** plus the `emit` schema-reference edit **U3**): a **format-v2 guide**, an **interactions + eject guide**, the **`emit` schema reference**, a **cross-page integration + version refresh**, and one **user-facing vanilla example**. It is documentation with real code artifacts: v2 YAML snippets are validated (`docs:validate-snippets`) and the example is wired into `pnpm verify:browser`. The overriding constraint is **truthfulness**: `emit` is inert under `<ml-map>` today, and the docs must frame it as an `attachInteractions`/host-map capability with that caveat, never over-promise it.

**Important limit on the snippet gate (from doc-review):** `docs:validate-snippets` validates only the **top-level document shape** — it parses the doc but the schema **silently strips unknown *nested* keys** (a mistyped or unshipped `hover.emit`, `flуTo`, etc. passes green while doing nothing). So a green snippet proves the document parses, **not** that a nested interaction key is real. Nested-key truthfulness rests on `ce-doc-review` + a targeted grep, not the validator — this is why `hover.emit` is deferred (U3/KD4) and why the truthfulness constraint is a human/review gate, not a CI one.

## Problem Frame

v0.6.0 ships v2 format, registry-backed interactions with an eject guarantee, GeoJSON sugar, and a set of behavior changes — but a user reading the docs would learn almost none of it:

- **Format v2 — the release headline — has zero user docs.** `version: 2` / `style:` / `basemap:` appear nowhere under `docs/src/content/docs`. Only an internal `examples/verification/v2/v2-document.html` fixture exists.
- **The interactions + eject runtime surface is undocumented.** `attachInteractions`, `projectInteractions`, and the `projectStyle`→style.json eject story (all shipped) have zero docs.
- **The integration + getting-started pages are stale.** They pin maplibre `@^4` (0.6 supports v4 **and** v5) and never show `attachInteractions` or v2. The stale `@^4` pin is **not just in `integrations/vanilla-js.mdx`** (doc-review): it also appears in `getting-started/{quick-start,installation,first-map}.mdx` and `integrations/web-components.mdx` — the pages a brand-new user hits *first*. **`integrations/web-components.mdx` (the primary `<ml-map>` doc) is the most exposed:** it's where users configure `<ml-map>`, so it's the page most tied to the emit-inert-under-`<ml-map>` truthfulness claim, yet it's v1-only. `integrations/astro.mdx` has the sugar section (shipped in #75) but no v2/interactions.
- **No user-facing vanilla example** — only the Astro app and internal `examples/verification/*.html` Playwright fixtures (which users don't discover).

The broader docs debt (positioning pages, per-component example coverage, the "Beyond YAML" page) stays in the ml-alp epic; this plan is only the four release-blocking capability gaps.

**Load-bearing discovery:** the runtime capabilities are already *demonstrated and tested* by verification fixtures — `examples/verification/emitter/eject.html` (`e2e/v050-emitter.spec.ts`), `examples/verification/interactions/compiled-interactions.html` (`e2e/interactions.spec.ts`), `examples/verification/v2/v2-document.html` (`e2e/v2-parser.spec.ts`). So the gap is *user-facing discoverability*, not building tested demos. The new docs reference these as proof, and the vanilla example (U5) can be a cleaned-up, documented user-facing version rather than net-new tested code.

## Requirements

- **R1.** A format-v2 guide teaches: `version: 2`; the `style:`/`runtime:` split (style compiles to `style.json`, runtime degrades/strips); `basemap:` (v1's `mapStyle`); per-source live-data nesting under a source's `runtime:`; per-layer interactions/legend/label under a layer's `runtime:`; `state:`/`parameters:` at the doc root. It leads with the **AE2 selling point**: v2 is *additive* — a v2 document and its v1 twin produce a deep-equal model and render/emit **identically**, so adoption is opt-in with no migration.
- **R2.** An interactions + eject guide covers: the declarative interactions (`popup`/`flyTo`/`zoomToFeature`/`highlight`, cross-linking the schema reference); the **eject guarantee** — `projectStyle` compiles a self-contained, spec-valid `style.json` that renders in vanilla MapLibre but is *inert* (the style spec can't express "open a popup"); and `attachInteractions(map, projection, options)` reattaching the declarative interactions onto **any** `maplibregl.Map` (a compiled style or a host's own map), so interactions survive eject.
- **R3.** `emit` is documented **truthfully**: it is a host-event interaction that fires only via `attachInteractions` with a **trusted** `policy` + a `hostHandlers` map (or a host map the embedder trusts). It is **inert under `<ml-map>`** today (untrusted default, no host handlers — fail-closed); making it live under `<ml-map>` is a tracked follow-up (ml-1lz). No doc over-promises emit under `<ml-map>`.
- **R4.** The stale-doc refresh spans **every page carrying the misinformation, not just two**: `integrations/vanilla-js.mdx`, `integrations/astro.mdx`, `integrations/web-components.mdx`, and `getting-started/{quick-start,installation,first-map}.mdx`. Each gets the maplibre note corrected to **v4 || v5**; the integration pages additionally get v2 + interactions/eject cross-links and a short "0.6 behavior changes" callout — the Astro `!html` loader fix (`loadYAML`/`loadFromGlob` now resolve `!html` to the `{$html}` marker, **gated by the popup capability policy — markup only under a trusted policy, escaped otherwise**), the new **v1 malformed-inline-GeoJSON warning** (promotes to error under `mlym validate --strict`/CI), and v2 `style.metadata` flowing to the emitted `style.json` root. `web-components.mdx` additionally gets the `<ml-map>` v2 note and the emit-inert-under-`<ml-map>` caveat (it is the primary `<ml-map>` doc).
- **R5.** One user-facing, discoverable vanilla example exists and is linked from the vanilla-JS page, wired into `pnpm verify:browser` (demo-as-test), hermetic (vendored maplibre, no external network).
- **R6.** Every fenced ` ```yaml ` snippet the plan adds parses under the built core parser, so `docs:validate-snippets` (and the whole `pnpm presubmit`) stays green. v2 snippets carry a top-level `version: 2` + `type:` so the validator checks them. **Caveat (doc-review):** the validator checks only the *top-level document shape* — the schema silently strips unknown *nested* keys, so a green snippet does **not** prove a nested interaction key (`click.emit`, `hover.emit`, `flyTo`, …) is real. The writer must ground every interaction snippet against the actual schema (`packages/core/src/schemas/layer.schema.ts`) and the `examples/verification/*` fixtures, because the gate won't catch a stripped-and-inert nested key.
- **R7.** The pass ships **no changeset** — it touches no published-package code (only `docs/`, `examples/`, `e2e/`), consistent with the auto-changeset policy.

## Key Technical Decisions

- **KD1 — Two new guides, not schema-page expansions.** `guides/format-v2.mdx` and `guides/interactions.mdx` are conceptual how-to content (the new format; the eject/runtime story) that belongs in Guides. The `schema/*` pages stay the *reference* (what keys exist); the guides link into them. `schema/interactivity.mdx` gets only the additive `emit` key (U3), not the runtime narrative.
- **KD2 — Reuse the existing verification fixtures' *patterns*, don't rebuild the tested behavior.** The eject, compiled-interactions, and v2-render demos already exist and are tested; the guides point at the *behavior* they prove. U5 is a **new, small, user-facing example page** that reuses those fixtures' hermetic import-map/guard pattern (not a literal one-fixture promotion — it synthesizes a clean "vanilla story" page and adds/extends a Playwright spec). The saving is that the underlying capability is already proven, so U5 is light — but it is authored, not copy-pasted.
- **KD3 — `emit` docs are host-map-framed with the `<ml-map>` caveat (truthfulness gate).** Every `emit` mention states it fires via `attachInteractions`+trusted policy+`hostHandlers`, and is inert under `<ml-map>` pending ml-1lz. This is the ml-alp "truthful claims" requirement made concrete. Verified accurate against the code in doc-review (emit needs *both* a trusted policy *and* a registered handler).
- **KD4 — `click.emit` is documented definitively; `hover.emit` is deferred until ml-fn9 merges — because the validator will NOT catch it, not because it fails.** Corrected in doc-review: a `hover.emit` snippet does **not** fail `docs:validate-snippets` — the non-strict hover schema (`layer.schema.ts`) **silently strips** the unknown `emit` key, so the snippet passes *green while doing nothing*. That is worse than a failure: a doc could ship a non-functional `hover.emit` the gate green-lights, directly violating the truthfulness thesis. So `hover.emit` waits for its schema key to actually ship (ml-fn9), and until then the only guard is human/`ce-doc-review` review — the same nested-key gap flagged in R6.
- **KD5 — Sidebar is manually curated** (`docs/astro.config.mjs` — explicit `items` arrays, not autogenerate). New guides need explicit sidebar entries in the Guides group.

## Implementation Units

### U1. Format-v2 guide

**Goal:** A `guides/format-v2.mdx` that teaches v2 and leads with the additive/AE2 selling point, with validated v2 snippets.

**Requirements:** R1, R6.

**Dependencies:** none.

**Files:**
- `docs/src/content/docs/guides/format-v2.mdx` (create)
- `docs/astro.config.mjs` (modify — add the Guides sidebar entry, KD5)

**Approach:** Open with "v2 is opt-in and changes nothing you've written": a v2 doc and its v1 twin render/emit identically (AE2). Then the shape: `version: 2` + `type: map`; `style: { basemap, center, zoom, sources, layers }` (compiles to `style.json`) vs `runtime: { map, controls, legend, container, parameters }` (degrades); per-source live-data under a source's `runtime:`; per-layer interactions/legend/label/toggleable under a layer's `runtime:`; `state:`/`parameters:` at the root. Show a v1 doc and its v2 twin side by side (the "same map, two ways" framing). Ground the shape against `packages/core/src/schemas/map-v2.schema.ts`, `packages/core/src/model/read-v2.ts`, and V2-D1..D6 in `docs/plans/2026-08-07-001-feat-format-v2-definition-plan.md`. Reference `examples/verification/v2/v2-document.html` as the tested proof that v2 renders.

**Execution note:** Draft the v2 snippets first and run `pnpm docs:validate-snippets` before prose — a v2 snippet that doesn't parse is the fastest failure signal, and the guide's credibility rests on the snippets being real.

**Patterns to follow:** an existing guide's structure and frontmatter (`docs/src/content/docs/guides/data-sources.mdx`); the v2 document shape in `examples/verification/v2/v2-document.html`.

**Test scenarios:**
- Each ` ```yaml ` block carrying `version: 2` + `type: map` parses under the built core parser (green `docs:validate-snippets`).
- A v2 snippet and the v1 twin snippet shown alongside it are both valid documents (both validate).
- `Test expectation: coverage is the snippet-validator + the docs build; no unit test. Verify via `pnpm presubmit`.`

---

### U2. Interactions + eject guide

**Goal:** A `guides/interactions.mdx` covering the declarative interactions, the eject guarantee, and `attachInteractions` reattachment — with `emit` framed truthfully.

**Requirements:** R2, R3, R6.

**Dependencies:** U3 (the `emit` schema reference this guide links to).

**Files:**
- `docs/src/content/docs/guides/interactions.mdx` (create)
- `docs/astro.config.mjs` (modify — Guides sidebar entry)

**Approach:** Three parts. (1) Declarative interactions recap — `popup`/`flyTo`/`zoomToFeature`/`highlight` on a layer's `click:`/`hover:`, linking `schema/interactivity.mdx` for the full reference. (2) The eject guarantee: `projectStyle(model)` compiles a self-contained, spec-valid `style.json` that renders anywhere MapLibre runs but is *inert* — nothing in the style spec expresses an interaction; reference `examples/verification/emitter/eject.html`. (3) Reattachment: `attachInteractions(map, projection, options)` (public API from `packages/core/src/interactions/index.ts`: `attachInteractions`, `projectInteractions`, `createInteractionRegistry`) wires the declarative interactions onto any `maplibregl.Map` — a compiled style or the host's own map — so interactions survive eject; reference `examples/verification/interactions/compiled-interactions.html`. Then **emit** per KD3/R3: a host-event interaction, fires via `attachInteractions` + trusted `policy` + `hostHandlers`, **inert under `<ml-map>`** (fail-closed) with the ml-1lz follow-up noted. Do not show a `<ml-map>` emit example that implies it works.

**Execution note:** The truthfulness of the emit section is the highest-risk content — write it against `packages/core/src/interactions/built-ins.ts` (the trust gate, ~the `allowsHostHook` check before `hostHandlers` resolution) and `packages/core/src/capabilities.ts` (`allowsHostHook` = `trust === "trusted"`; `DEFAULT_POLICY` untrusted) so the "trusted policy **and** a registered `hostHandlers` entry, inert under `<ml-map>`" claim is exact — emit needs *both*, not either.

**Patterns to follow:** the eject/attach behaviors as proven in `e2e/v050-emitter.spec.ts` and `e2e/interactions.spec.ts`; the declarative surface already in `schema/interactivity.mdx`.

**Test scenarios:**
- Any ` ```yaml ` interaction snippet (a layer with `click: { popup: … }`) validates.
- No snippet or prose claims `emit` fires under `<ml-map>` (reviewer/`ce-doc-review` truthfulness check; grep the guide for an `<ml-map>` + `emit` co-occurrence that implies it works).
- `Test expectation: snippet-validator + docs build + the truthfulness review. Verify via `pnpm presubmit`.`

---

### U3. Document the `emit` interaction in the schema reference

**Goal:** Add the `emit` declarative key to `schema/interactivity.mdx` (the reference), with the trust/host-handler + `<ml-map>`-inert caveat. `click.emit` only (KD4).

**Requirements:** R3, R6.

**Dependencies:** none.

**Files:**
- `docs/src/content/docs/schema/interactivity.mdx` (modify — add an `emit` subsection under Layer Interactivity → Click)

**Approach:** Document `click: { emit: { event, payload } }` — the config shape (from `packages/core/src/schemas/layer.schema.ts` `EmitConfig`), the declarative payload projection (`str`/`property`/`else`), and the trust/host-handler requirement with the `<ml-map>`-inert caveat (KD3). Add a validated snippet. Note `hover.emit` as "coming with the hover-emit feature" only if ml-fn9 has merged (KD4/OQ2); otherwise omit it entirely so no snippet references an unshipped schema key.

**Test scenarios:**
- A `click: { emit: { event: "select", payload: { id: { property: "id" } } } }` snippet validates under the built parser.
- The section states emit is inert under `<ml-map>` (truthfulness).
- `Test expectation: snippet-validator. Verify via `pnpm presubmit`.`

---

### U4. Refresh the integration + getting-started pages (every page carrying stale 0.6 misinformation)

**Goal:** Bring all pages that misinform a 0.6 user up to date — v2 + interactions cross-links on the integration pages, the maplibre `v4 || v5` fix *everywhere it's pinned `@^4`*, the emit-inert caveat on the primary `<ml-map>` page, and the 0.6 behavior-change callout.

**Requirements:** R4, R6.

**Dependencies:** U1, U2 (the guides these pages cross-link).

**Files:**
- `docs/src/content/docs/integrations/vanilla-js.mdx` (modify)
- `docs/src/content/docs/integrations/astro.mdx` (modify)
- `docs/src/content/docs/integrations/web-components.mdx` (modify — the primary `<ml-map>` doc: v4||v5, v2 note, the emit-inert-under-`<ml-map>` caveat)
- `docs/src/content/docs/getting-started/quick-start.mdx`, `docs/src/content/docs/getting-started/installation.mdx`, `docs/src/content/docs/getting-started/first-map.mdx` (modify — the stale `maplibre-gl@^4` import-map/install pin a new user hits first; correct to v4 || v5)

**Approach:** First **grep every doc for `maplibre-gl@^4` / `@^4`** and correct each to **v4 || v5** (peer range `^4.0.0 || ^5.0.0`) — doc-review found this pin in the four getting-started/web-components pages above, not just vanilla-js.mdx; shipping the release with "v4-only" on the first pages a user reads is the exact truthfulness gap this plan exists to close. Then, on the integration pages: vanilla-js.mdx — add a section pointing at the new format-v2 and interactions/eject guides, and link the U5 example. astro.mdx — v2 + interactions cross-links alongside the existing sugar section. web-components.mdx — a `<ml-map>` v2 note and the **emit-inert-under-`<ml-map>` caveat** (this is where users configure `<ml-map>`, so it must carry the caveat KD3 requires). Add a short "**Upgrading to 0.6**" callout on the integration pages: the Astro `!html` loader fix (now resolves `!html` to `{$html}`, gated by the popup policy — so `!html` renders as markup only under a trusted policy, else escaped), the v1 malformed-inline-GeoJSON **warning** (promotes to error under `mlym validate --strict`/CI — so pre-check inline geometry), and v2 `style.metadata` → emitted `style.json` root. Keep claims truthful (`!html` is trust-gated, not "renders HTML").

**Test scenarios:**
- Any ` ```yaml ` blocks added validate.
- The maplibre version note reads `v4 || v5` (no remaining `@^4`-only claim in the peer/import-map guidance).
- `Test expectation: snippet-validator + docs build. Verify via `pnpm presubmit`.`

---

### U5. A user-facing vanilla example, wired into verify:browser

**Goal:** One clean, discoverable, user-facing vanilla example — ideally the eject → `attachInteractions` flow (the most under-served capability) — **authored** (reusing the existing fixtures' hermetic patterns, not a literal one-fixture copy), linked from vanilla-js.mdx, and covered by `pnpm verify:browser`. It is light because the capability is already proven; it is still a new page + spec.

**Requirements:** R5, R7.

**Dependencies:** U4 (links to it).

**Files:**
- an `examples/` page (create — placement is OQ1: a new `examples/vanilla/` user-facing dir vs. promoting an existing `examples/verification/*` fixture)
- `e2e/<name>.spec.ts` (create or extend — Playwright coverage, hermetic, per the `e2e/*.spec.ts` pattern)
- `docs/src/content/docs/integrations/vanilla-js.mdx` (modify — link the example; may overlap U4's edit)

**Approach:** Prefer promoting/cleaning an existing verification fixture over net-new code (KD2): `examples/verification/interactions/compiled-interactions.html` already proves `attachInteractions` on a compiled style, and `emitter/eject.html` proves eject. Produce a clean, commented, user-readable vanilla page that shows the full story — parse a YAML doc → render via `<ml-map>` *or* compile → eject `style.json` → `attachInteractions` reattaches interactions — mirror the hermetic e2e pattern (vendored maplibre via the import map, no external network, served by `e2e/server.mjs`), and add/extend a Playwright spec so `verify:browser` covers it. Link it prominently from vanilla-js.mdx. Confirm no published-package code changed → no changeset (R7).

**Execution note:** Runtime/smoke verification — the example's job is "does it render/attach in a real browser," proven by the Playwright spec; no unit tests. Reuse the existing hermetic fixtures' import-map + guard pattern so the suite stays offline.

**Patterns to follow:** `examples/verification/interactions/compiled-interactions.html` + `e2e/interactions.spec.ts`; `examples/verification/emitter/eject.html` + `e2e/v050-emitter.spec.ts`; the hermetic `guard()`/import-map convention.

**Test scenarios:**
- The example page loads and renders in a real browser with no page/console errors and no off-origin requests (hermetic), asserted by the Playwright spec; wired into `pnpm verify:browser`.
- If it shows the eject+attach flow: the compiled style renders *and* an interaction (e.g. a popup) fires after `attachInteractions`, proving interactions survive eject.
- `Test expectation: browser smoke via the new/extended e2e spec. Verify via `pnpm verify:browser`.`

---

## Scope Boundaries

**In scope:** the four release-blocking capability gaps, delivered as five units — format-v2 guide (U1), interactions+eject guide (U2), the `emit` schema reference (U3), the cross-page integration + version refresh (U4, now covering the getting-started + web-components pages too), one user-facing vanilla example (U5). All docs/examples/e2e only; no published-package code; no changeset.

**Out of scope / non-goals:**
- The rest of the ml-alp epic: positioning pages ("Why maplibre-yaml"), per-component example coverage (Scrollytelling/FullPageMap), the "Beyond YAML" lifecycle page, the vanilla-troubleshooting page, CI smoke-build for examples, measured bundle-size claims. File/leave these as ml-alp children for after the release.
- Any product/behavior change (this is docs only). If a doc reveals a real behavior gap, file a bead — do not fix it here.
- A CI-enforced truthfulness check for nested interaction keys (the validator can't do it — R6). This pass relies on `ce-doc-review` + grep; automating it is out of scope (candidate ml-alp follow-up).

**Deferred to Follow-Up Work:**
- **`hover.emit` docs** — a small addition to U2/U3 once ml-fn9 lands (its schema key must ship first, or the snippet fails validation).
- **Emit-under-`<ml-map>` docs** — when ml-1lz ships the trust surface, revisit the emit sections to document the live `<ml-map>` path.

---

## Verification Contract

- `pnpm presubmit` green — critically `docs:validate-snippets` (every new ` ```yaml ` snippet parses) and the docs build.
- `pnpm verify:browser` green, including the U5 example's Playwright coverage.
- No `.changeset/*.md` added (docs/examples/e2e only — R7); `changeset status` shows no *new* bump attributable to this branch.
- Truthfulness (a human/review gate, **not** the validator — R6): no doc claims `emit` fires under `<ml-map>`, and no interaction snippet uses an unshipped/mistyped nested key that the schema would silently strip (`hover.emit` until ml-fn9). Enforced by `ce-doc-review` + a grep for `<ml-map>`+`emit` co-occurrence and for nested keys not in `layer.schema.ts`.
- No stale `maplibre-gl@^4`-only pin remains in any doc (grep clean) — the version note reads v4 || v5 everywhere (R4).

## Definition of Done

1. `guides/format-v2.mdx` teaches v2 with the additive/AE2 framing and validated snippets; sidebar-wired (R1).
2. `guides/interactions.mdx` covers declarative interactions + the eject guarantee + `attachInteractions` reattachment (R2), with `emit` framed truthfully (R3); sidebar-wired.
3. `schema/interactivity.mdx` documents `click.emit` with the trust/`<ml-map>`-inert caveat (R3).
4. Every page carrying stale 0.6 info is refreshed — `integrations/{vanilla-js,astro,web-components}.mdx` + `getting-started/{quick-start,installation,first-map}.mdx`: v2/interactions cross-links where relevant, maplibre v4||v5 *everywhere it was pinned `@^4`*, the emit-inert caveat on `web-components.mdx`, the 0.6 behavior-change callout (R4).
5. A user-facing vanilla example is linked from vanilla-js.mdx and covered by `verify:browser` (R5).
6. `pnpm presubmit` + `pnpm verify:browser` green; no changeset (R6, R7).
7. The five units are filed as ml-alp children; the two deferred items are recorded.

## Open Questions (plan-time details)

- **OQ1 — vanilla example placement (U5):** a new user-facing `examples/vanilla/` dir vs. promoting/cleaning an existing `examples/verification/*` fixture in place. Recommended: a small new `examples/vanilla/` page (clearly user-facing + discoverable) that reuses the hermetic import-map/guard pattern and is served/tested the same way — so it reads as an example, not a test fixture, while still being covered by `verify:browser`. Implementer's call from the actual fixtures.
- **OQ2 — `hover.emit` timing (U3):** document it only after ml-fn9 merges (its schema key must exist for the snippet to validate). Until then, `click.emit` only. If ml-fn9 lands before this pass finishes, add the `hover.emit` note in the same PR.
- **OQ3 — depth of the v1↔v2 side-by-side (U1):** one representative "same map, two ways" pair vs. a fuller mapping table of where each v1 key moves in v2 (the V2-D3 `config:`-cut table). Recommended: one side-by-side pair in the guide body + a compact "where did my key go?" table, since the cut is the most common migration question — but keep it a table, not prose.
