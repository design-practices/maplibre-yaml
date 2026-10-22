# docs: Positioning & Examples — Say What It's For, Show the Differentiators

**Phase:** 3 of the [meta-plan](./meta-plan-stabilization-and-roadmap.md)
**Status:** Approved (sequencing confirmed by Mario)
**Depends on:** Phase 1 Workstream F (doc corrections) so new pages build on accurate ground

## Overview

The docs never answer "why not `new maplibregl.Map({style})`?", and the runnable examples demonstrate none of the three headline differentiators (live/realtime data, scrollytelling, full-page maps) — those exist only as docs prose and loose config files. This plan adds an honest positioning page, fixes the inflated bundle claim, and makes the differentiators runnable.

## Problem Statement

- No comparison/when-not-to-use page exists. The closest artifact is the JS-vs-YAML side-by-side in `introduction.mdx:28-74`, framed as "how it works", not as a trade-off.
- `index.mdx` claims "keeping bundles tiny (~165KB)"; the actual browser bundle is 537 KB unminified plus maplibre-gl. An honest number (or a real budget, see perf plan) is required — this claim is checkable and currently false.
- Runnable examples (`examples/astro/minimal`, `examples/astro/otf`) exercise only the static/content-collection story. Grep confirms no example page uses `<Scrollytelling>`, `<FullPageMap>`, or any `refresh:`/streaming config. The polling/SSE machinery — the strongest reason to choose this library — is demonstrated nowhere a user can run.
- The three-persona story (students / developers / content creators) is consistent but unweighted; the assessment's read is that the validated identity is **declarative data-layer runtime + Astro content-collection integration** (meta-plan, "what the product actually is").

## Proposed Solution

### 1. "Why maplibre-yaml (and when not to use it)" page

New `getting-started/why.mdx`, linked second in the sidebar. Structure:

- **Lead with the runtime data layer**, not syntax: declaring `source: {type: geojson, url, refresh: {...}}` buys fetch, caching, conditional requests, retry/backoff, visibility-aware polling, merge strategies, and SSE/WebSocket reconnection — a comparison snippet showing the ~80 lines of hand-rolled JS it replaces (this is the honest version of the existing JS-vs-YAML comparison).
- **Feature matrix** vs raw MapLibre GL JS and vs static style JSON: validation with positions, declarative popups/hover, live data, content-collection integration, web component, CLI/CI validation.
- **"Use MapLibre directly when…"** — custom interaction logic beyond popup/flyTo, imperative animation, custom layers/WebGL, apps where the map config is built dynamically in code anyway. Honesty here is what makes the rest credible.
- **What it is not:** not a hosted studio (vs Felt/Mapbox Studio), not an analysis tool (vs kepler.gl), not a style editor.

### 2. Truthful performance claims

Replace "~165KB" with measured numbers once the perf plan sets the budget; until then, state the honest current numbers and that maplibre-gl is a peer you load anyway. Never publish an unmeasured size claim again (the perf plan adds a size-check to CI that the docs number is generated from).

### 3. Make the differentiators runnable

- **`examples/astro/live-data/`** — new small app: USGS earthquake feed with `refresh:` polling + merge strategy (promote `docs/public/configs/earthquake-tracker.yaml` from prose to a running page), plus one SSE/WebSocket demo against a tiny bundled mock server (a ~30-line Node script emitting positions, so the example works offline).
- **Scrollytelling + FullPageMap pages added to `examples/astro/minimal`** — the components exist and are documented; they have simply never been exercised in a runnable app. This will double as the first real integration test of `<Scrollytelling>` against current core (today it's only exercised via `otf`'s stale beta node_modules).
- Each example page links its source and its YAML; each YAML carries the `# yaml-language-server: $schema=` modeline (Phase 2).
- CI: examples get a `pnpm build` smoke job so they can't rot again (the `otf` staleness found in the assessment is the cautionary tale).

### 4. Alignment pass on the persona story

- Re-order `index.mdx` cards to lead with the data-layer and collections value; keep the three personas but route them ("writing a blog/story site → Astro path; embedding one map in any page → web component path; validating configs in CI → CLI path").
- Reconcile the two competing next-step paths (`introduction.mdx` vs `installation.mdx`) into one: Introduction → Installation → Quick Start → First Map.
- Write the missing `guides/styling.mdx` (the sidebar promised it; Phase 1 removed the dead link, this phase restores it with content: mapStyle sources, paint properties, the astro builders' default-style constants and how to override them).
- General troubleshooting page for the vanilla path: blank map checklist (height, CSS, mapStyle, CORS), consolidating what currently exists only in the Astro README.

## Testing strategy

- Example apps build in CI (`pnpm -r --filter './examples/**' build`).
- Docs snippet validation (from Phase 1 F) extended to the new pages.
- Link checker over the docs build (catches the dead-sidebar-link class of bug).

## Out of scope

- README-length marketing rewrite of the root README (small alignment edits only).
- Video/gif production, hosted playground — worth discussing as a future item; a playground is the natural "student" on-ramp but is real infrastructure.
- API reference generation (TypeDoc) — removed from nav in Phase 1; reinstating is a separate decision.

## Open questions for review

1. The "when not to use it" list — comfortable publishing it? (Recommendation: yes, verbatim honesty; it's the most-trusted page pattern in dev tools.)
2. Should the live-data example ship a mock SSE server, or depend only on public feeds? (Recommend mock server: public feeds rot and rate-limit.)
3. Hosted playground: in or out of the 2026 picture? Affects how hard the "students" persona can be pushed.
