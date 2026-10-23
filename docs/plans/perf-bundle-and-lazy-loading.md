# perf: Bundle Budget, Lazy Loading & Data-Layer Hygiene

**Phase:** parallel track of the [meta-plan](./meta-plan-stabilization-and-roadmap.md) — can run alongside Phases 2–4; no schema coupling
**Status:** Approved (sequencing confirmed by Mario)

## Overview

Set an explicit, CI-enforced size budget; stop shipping the live-data machinery to maps that don't use it; fix three data-layer lifecycle gaps; and shrink the pathological 3.5 MB declaration file. No public API changes.

## Problem Statement

- **No budget, false claim.** Docs say "~165KB"; reality: `dist/index.js` 148 KB, `dist/register.js` 155 KB, `dist/register.browser.js` 537 KB (unminified, pre-gzip). No size check exists, so claims and reality drift silently.
- **Everything loads always.** `LayerManager` unconditionally instantiates `DataFetcher`, `PollingManager`, `StreamManager`, `DataMerger`, `LoadingManager` per map (`layer-manager.ts:58-72`); importing `/register` pulls polling + SSE + WebSocket + merge + retry code even for a static inline-data map.
- **Lifecycle gaps in the data layer:** no in-flight request dedupe — concurrent fetches of the same URL both hit the network, and `activeRequests` keying just overwrites (`data-fetcher.ts:365`); `DataFetcher.abortAll()` exists but teardown only aborts a never-populated legacy map (`layer-manager.ts:404-408,517`), so pending fetches outlive removed layers/maps; `RetryManager.reset()` is a documented no-op stub (`retry-manager.ts:281-283`).
- **Type-level weight:** `dist/page.schema-*.d.ts` is **3.5 MB** (recursive `z.lazy` MixedBlock union × verbose JSDoc), with `z.ZodType<any>` casts already sprinkled to dodge TS7056. Every TS consumer pays this in editor/typecheck latency.
- **Re-render is a full teardown:** any `config`/`src` change destroys and recreates the whole `maplibregl.Map` (`ml-map.ts:285-333`). Acceptable now; blocks the map-party diff/reconcile ask later.

## Proposed Solution

### 1. Budget + enforcement first

- Add `size-limit` (or a small gzip-size script) to core CI with checked-in thresholds: start at current reality + slack (e.g. `register.browser.js` ≤ 160 KB **gzipped**; measure first, then set), tighten after step 2 lands.
- Docs' size claims become generated from the same measurement (feeds the Phase-3 truthful-claims item).
- Add minification to the browser build (`tsup` `minify: true` for the `register.browser` entry) — free ~60% on the CDN path; source maps already ship.

### 2. Lazy-load the live-data machinery

- `LayerManager` constructs polling/streaming/merge lazily via dynamic `import()` only when a parsed config actually declares `refresh:`/`stream:`/legacy refresh fields; `DataFetcher` (plain URL fetch) stays eager since any `url:` source needs it. tsup gets `splitting: true` so the dynamic imports become real chunks in both builds.
- Acceptance: a static inline-`data:` map's loaded JS contains no polling/SSE/WebSocket/merge code (assert via bundle analysis in the size CI job); a `refresh:` map still polls (existing integration tests).
- Note for the CDN path: chunks change the unpkg story from one file to several — verify `register.browser.js` + chunks resolve over unpkg (extend `verify-alpha-publish.sh` from Phase 1 B), or keep the browser build unsplit and accept the larger single file there; decide by measuring how much of the 537 KB is live-data code.

### 3. Data-layer lifecycle fixes

- **Dedupe:** in `DataFetcher.fetch`, coalesce concurrent same-URL requests onto one promise (keyed by URL + relevant options), refcount abort so one consumer cancelling doesn't kill the other's request.
- **Teardown:** wire `dataFetcher.abortAll()` (and per-layer aborts) into `LayerManager.removeLayer`/`destroy`; delete the dead legacy `abortControllers`/`refreshIntervals` path (overlaps Phase 1 G — whichever lands first takes it).
- **Implement or delete `RetryManager.reset()`** — a documented no-op is worse than either.
- Leave the merge-strategy O(n log n) re-sort (`data-merger.ts:254-258`) alone until a real workload complains — add the vitest bench from todo `034-P` so we have a baseline, and note the threshold in the bench file.

### 4. Declaration-file diet

- Target: `page.schema` `.d.ts` under ~200 KB. Approach, in order of preference: (a) replace inferred types at the recursive-union boundary with explicit, hand-written interfaces (`MixedBlock`, `Page`, `Root`) and `z.ZodType<Explicit>` annotations — this collapses the structural explosion and *removes* the TS7056 hacks rather than adding more; (b) if that sacrifices too much inference elsewhere, split page schemas into their own entry so map-only consumers never load them.
- Acceptance: `.d.ts` size checked in the same CI job; `tsc --noEmit` time on a consumer fixture measured before/after.

### 5. Explicitly deferred

- Diff-based re-render / style reconciliation (the map-party `onStyleReconciled` prerequisite): real renderer rework; decide after Phase 5. Until then, document that attribute changes recreate the map.
- Consolidating Astro's duplicate controls/legend/`whenMapReady` implementations into core exports — worthwhile refactor, queue behind Phase 1 C so it consolidates onto the *working* core path.

## Testing strategy

- Size CI job (budgets for both builds + the `.d.ts`).
- Bundle-content assertion for the lazy split (no polling/streaming code in the static-map chunk).
- Dedupe/abort unit tests: two concurrent fetches → one network call; `destroy()` → in-flight fetch aborted (fake timers + mock fetch already exist in the data tests).
- Bench baseline for merge strategies (todo `034-P`).

## Open questions for review

1. Budget numbers: is ~160 KB gzipped for the CDN bundle the right ceiling, or do you want an aggressive target that forces the lazy split into the browser build too?
2. Is editor/typecheck latency actually bothering you in consuming projects? If not, the `.d.ts` diet can slide to lowest priority within this plan.
