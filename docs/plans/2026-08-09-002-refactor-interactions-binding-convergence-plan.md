---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-brainstorm
type: refactor
bead: ml-wx2
title: "Converge the interaction binding onto one path (R9) - Plan"
date: 2026-08-09
---

# Converge the interaction binding onto one path (R9-epic) - Plan

**Bead:** ml-wx2 · **Source:** ce-brainstorm (2026-08-09), enriched by ce-plan · **Deferred from:** ml-cbm (U5, PR #73). *("R9" is the interactions-roadmap/epic ID for this convergence; the granular requirements below are R1–R7.)*

**Product Contract preservation:** changed — two plan-time adjustments, both from findings ce-plan verified against the code:
1. **R4 and KD3 narrowed** (per an explicit user decision): the `<ml-map>` emit-goes-live behavior (a trust surface + DOM `CustomEvent` bridge + browser test) is **deferred to a follow-up**. `<ml-map>` has no trust surface today (it never passes `capabilities` to `MapRenderer`), so the brainstorm's OQ3 premise was false and the original R4 was unreachable in one bead. **R5 is NOT narrowed** — untrusted-denies is unchanged behavior.
2. **KD1's mechanism corrected** (doc-review, user-confirmed): the brainstorm's "EventHandler thin-shells `attachInteractions`" is infeasible — `attachInteractions` is *all-at-once* (`(map, projection, options)`, binds every layer in one loop, no incremental `attachLayer` on its handle) while `EventHandler.attachEvents(layer)` is driven *incrementally* by `MapRenderer.addLayer`. The one-binding-path goal is met instead by **extracting attach's per-layer bind into a shared core both call** (the brainstorm's rejected option, which is the shape attach's structure permits). R1–R3, R6, R7 and KD2 are unchanged.

## Summary

Extract the per-layer interaction binding (`map.on` for click/mouseenter/mouseleave/mousemove, the `select`-ordered dispatch, cursor, and popup lifecycle) — today a private `attachLayer` closure inside `attachInteractions` — into one shared per-layer bind core. `attachInteractions` keeps its all-at-once loop and `InteractionsHandle`, now built on that core; the renderer's `EventHandler` calls the same core per-layer from its incremental `attachEvents(layer)` path, converting its raw `Layer` to the projected entry the core expects. Threading `policy`/`hostHandlers` through the core makes the `emit` trust-gate honored under the renderer for the first time. This bead changes **no** `<ml-map>` user-facing behavior — `MapRenderer` still supplies the default untrusted policy and no host handlers, so `click.emit` stays inert under `<ml-map>` exactly as today.

## Goal Capsule

- **Objective:** One per-layer binding implementation, shared by `attachInteractions` and `EventHandler`; `emit` made trust-gate-honoring on that shared path. No `<ml-map>` behavior change this bead.
- **Product authority:** This document. Product decisions (R1–R7, KD2) are settled; the plan-time adjustments to R4/KD3 and KD1's mechanism are recorded above (KD4 is a test-layer decision).
- **Open blockers:** None. Parity between the two current paths is proven green (`attach.test.ts`).

---

## Problem Frame

`attachInteractions` (`packages/core/src/interactions/attach.ts`) and the renderer's `EventHandler` (`packages/core/src/renderer/event-handler.ts`) are **two live copies** of the per-layer `map.on` binding, the `select`-ordered dispatch, cursor handling, and popup lifecycle. Three NOTEs (in `attach.ts`, `event-handler.ts`, `built-ins.ts`) document the duplication and instruct that every change land in both. Costs: **drift** (every binding change made twice) and a **structural gap** — `EventHandler`'s `interactionDeps` deliberately omit `policy`/`hostHandlers`, so `emit` resolves every event to a denial regardless of trust.

The two are shaped differently, which is why they can't merge by simple delegation (verified):
- `attachInteractions(map, projection, options)` is **all-at-once**: it wires every layer from a fully-projected `InteractionsProjection` in one loop (its private `attachLayer(layerId, entry)` closure), and returns an `InteractionsHandle` of only `resetFeatureState`/`detach`/`destroy` — no way to add a layer afterward.
- `EventHandler.attachEvents(layer)` is **incremental**: `MapRenderer.addLayer` calls it once per raw `Layer` (deriving the source itself), at any time.

So the reconciliation is a **shared per-layer bind function**: extract `attachLayer` (and its dispatch/cursor/popup/feature-state helpers) to module scope, have `attachInteractions`'s loop call it, and have `EventHandler` call it per-layer too. `attachInteractions` is already the more complete side (it threads `policy`/`hostHandlers`, owns the popup lifecycle via `PopupBuilder(policy)`/`activePopup`/`destroy`, and has cursor + feature-state), so the shared core is lifted from it with minimal change, and `EventHandler` sheds its duplicate.

**What ce-plan descoped:** making `emit` fire end-to-end under `<ml-map>` needs a new (security-sensitive) `<ml-map>` trust surface plus a host-event bridge, because `<ml-map>` can't mark a document trusted today. Per the user's decision, that is a filed follow-up; this bead makes `emit` *capable* on the shared path and stops there (fail-closed — emit stays inert).

---

## Key Technical Decisions

- **KD1 — Extract a shared per-layer bind core; both `attachInteractions` and `EventHandler` call it.** *(Mechanism corrected from the brainstorm's "thin shell", which is infeasible — see the preservation note.)* The core is the per-layer binding + dispatch + cursor + popup + feature-state, lifted from attach's private `attachLayer`. `attachInteractions`'s all-at-once loop calls it per layer (behavior-preserving); `EventHandler.attachEvents` calls it per layer incrementally. Both become thin over the core.
- **KD2 — The shared core takes an optional raw-event callback hook.** *(Unchanged.)* Carries the renderer's `onClick`/`onHover`, which fire on every click/hover after dispatch, independent of interaction dispatch. Opt-in, so the compiled-map path (`attachInteractions` with no callbacks) stays callback-free.
- **KD3 — emit becomes trust-gate-honoring on the shared path; the `<ml-map>` end-to-end behavior is deferred.** *(Narrowed.)* Threading `policy` (and an optional `hostHandlers`) into the core means `emit`'s `allowsHostHook(policy)` gate is honored under the renderer: trusted+registered-handler dispatches, trusted+no-handler warns, untrusted denies. `MapRenderer` still supplies the default untrusted policy and no `hostHandlers`, so under `<ml-map>` emit stays inert. The trust surface + DOM bridge that would light it up are deferred (Scope Boundaries). Threading the optional `hostHandlers` param now completes the internal path so the follow-up adds only the *supplier*, not another `EventHandler` change — a cheap seam, not speculative behavior (it can never fire without an independent trusted policy + supplied handler, neither of which exists under `<ml-map>`).
- **KD4 — The emit-inert characterization test changes with intent.** `tests/renderer/event-handler.test.ts` (~line 420) asserts emit "does not dispatch or warn … even with a trusted policy" and states the expectation must change consciously when policy is threaded. After KD1/KD3 a **trusted** policy with no handler *warns* (the existing `built-ins.ts` warn, now reachable); the test is rewritten to assert that, and that untrusted still denies silently. This is the one intended behavior delta, and it is at the unit-test layer — no `<ml-map>`-level behavior changes.
- **KD5 — `EventHandler` converts its raw `Layer` to the core's projected entry per-layer; it does NOT reuse `projectInteractions`.** The shared core takes a `ProjectedLayerInteractions` (`{ source, interactive }`); `EventHandler` has a raw `Layer` and derives the source itself today. A small per-layer converter extracts `interactive` and derives `source`. It must **not** route through `projectInteractions` (which takes a whole `MapModel` and *drops `emit` under an untrusted policy at projection time*) — doing so would strip emit before the runtime trust gate, masking rather than exercising the KD3 shared-path behavior.

---

## High-Level Technical Design

```
BEFORE (two copies)
  attachInteractions(map, projection, opts) ── private attachLayer() loop ──→ map.on + dispatch + cursor + popup
                                            └─ threads policy/hostHandlers → emit works
  EventHandler.attachEvents(layer) ─────────── own per-layer bind ──────────→ map.on + dispatch + cursor + popup
                                            └─ deps OMIT policy/hostHandlers → emit inert

AFTER (one core)
                         ┌───────────────────────────────────────────────────────┐
                         │  bindLayerInteractions(map, layerId, entry, deps)      │  ← shared core (from attach.attachLayer)
                         │  map.on(click/enter/leave/move) + dispatch + cursor    │
                         │  + popup lifecycle + feature-state; deps carry          │
                         │  { registry, policy, hostHandlers?, callbacks? }        │
                         └───────────────────────────────────────────────────────┘
                              ▲                                   ▲
   attachInteractions(map, projection, opts)          EventHandler.attachEvents(layer)
     loops projection.layers → core (all-at-once)        raw Layer → {source, interactive} (KD5)
     returns InteractionsHandle                          → core, per layer (incremental)
     (compiled/host path; no callbacks)                  callbacks = {onClick,onHover}; policy from
                                                         options.capabilities; hostHandlers = undefined
                                                         (MapRenderer supplies none → emit inert under <ml-map>)
```

---

## Implementation Units

### U1. Extract the shared per-layer bind core + add the raw-event callback hook

**Goal:** Lift attach's private `attachLayer` (binding + dispatch + cursor + popup + feature-state) to a module-level shared core that takes a `deps` bundle including an optional `onClick`/`onHover` callback hook (KD2); refactor `attachInteractions` to call it. Behavior-preserving for every current `attachInteractions` caller.

**Requirements:** R1, R2, KD1, KD2.

**Dependencies:** none.

**Files:**
- `packages/core/src/interactions/attach.ts` (modify — extract `attachLayer` + its `dispatch`/cursor/popup/`clearInteractionState` helpers into a shared per-layer bind function/factory; `attachInteractions` calls it; add the optional callback hook to the core's `deps` and fire it after dispatch)
- `packages/core/src/interactions/types.ts` (modify if the callback/deps types are declared there)
- `packages/core/tests/interactions/attach.test.ts` (modify — callback timing + compiled-path-callback-free)

**Approach:** Move the closure to a module-level `bindLayerInteractions(map, layerId, entry, deps)` (name is OQ) whose `deps` carry `{ registry, policy, hostHandlers?, popupBuilder, boundHandlers, callbacks? }` — whatever the closure reads today — so both callers share exactly one binding. `attachInteractions` builds the `deps` (as now) and loops `projection.layers` calling the core; its `InteractionsHandle` (`resetFeatureState`/`detach`/`destroy`) is unchanged. Add the optional `callbacks: { onClick?, onHover? }` to `deps`, fired **after** the existing `dispatch()` so interaction handlers still run first — matching `EventHandler`'s current timing. Widen the core's `mouseenter` handler to receive the event (attach's current `mouseenter` takes no arg; `EventHandler` reads `e.features?.[0]`), so `onHover` gets the same `(layerId, feature, lngLat)` `EventHandler` passes today.

**Execution note:** Behavior-preserving extraction first — `attach.test.ts` and the whole suite must stay green after U1 with the compiled path passing no callbacks, before U2 depends on the core.

**Patterns to follow:** the existing `attachLayer` closure and `dispatch`/`clearInteractionState`/`destroy` in `attach.ts`; `EventHandler`'s `onClick`/`onHover` fire sites (`event-handler.ts` ~140, ~187) for exact hook timing and arguments.

**Test scenarios:**
- Every existing `attach.test.ts` assertion (identical listener tuples over the 4 configs; dispatch order; cursor; popup open/replace/remove; feature-state) passes unchanged through the extracted core.
- With `callbacks.onClick` set, it fires once per click after dispatch with `(layerId, feature, lngLat)`.
- With `callbacks.onHover` set, it fires on mouseenter with the same signature and the correct `feature` (proves the widened mouseenter arg).
- With `callbacks` absent (compiled path), nothing fires and dispatch is unchanged — pins the opt-in boundary.

---

### U2. `EventHandler` calls the shared bind core per-layer

**Goal:** Replace `EventHandler`'s duplicated per-layer binding with a call into U1's shared core, converting its raw `Layer` to the projected entry (KD5) and threading `policy` (and optional `hostHandlers`) so the emit trust-gate is honored — while preserving `EventHandler`'s public surface and the 144 characterization tests.

**Requirements:** R1, R3, R4 (narrowed — capable, not `<ml-map>`-live), R5, R6, KD1, KD3, KD4, KD5.

**Dependencies:** U1.

**Files:**
- `packages/core/src/renderer/event-handler.ts` (modify — `attachEvents(layer)` builds a `{ source, interactive }` entry from the raw layer and calls the shared core with `callbacks`, `policy` from the constructor's `capabilities`, and optional `hostHandlers`; drop the now-shared binding/dispatch/cursor/popup/`clearInteractionState`/`layerToSource`; `resetFeatureState`/teardown delegate to the core's per-layer teardown)
- `packages/core/tests/renderer/event-handler.test.ts` (modify — keep characterization assertions green; rewrite the "emit inert even with a trusted policy" block per KD4; add the two security regressions below)

**Approach:** `attachEvents(layer)` converts the raw `Layer` to `{ source: <derived as today>, interactive: layer.interactive }` (KD5 — a local per-layer helper, NOT `projectInteractions`), then calls U1's core with `deps` carrying `callbacks: { onClick, onHover }` (EventHandler's existing callbacks), `policy` (the `capabilities` the constructor already receives — route it into the core instead of only into a now-removed local `PopupBuilder`), and an optional `hostHandlers` param (defaults undefined; `MapRenderer` supplies none this bead — completing the path for the follow-up). Keep one `PopupBuilder(policy)` — the core owns it, so `EventHandler` drops its own. `resetFeatureState(layerId)` and teardown/detach delegate to the core's feature-state clear and detach. Confirm `MapRenderer` needs no change (it already passes `options.capabilities`); if a param must widen, keep it additive.

**Execution note:** Characterization-first and incremental — the 144 renderer characterization tests + `attach.test.ts` are the safety net and must stay green at each commit. Land the delegation so all pass **except** the one emit-inert test, then rewrite that test per KD4 as its own reviewable change; do not silently flip it.

**Patterns to follow:** U1's shared core signature; `EventHandler`'s current source derivation (`event-handler.ts` ~129–131) for the converter; the popup ownership already in `attach.ts` (`PopupBuilder`/`activePopup`/`destroy`) as the thing `EventHandler` drops; the `!html`-de-drift pattern (a consumer using the canonical implementation, not re-declaring it).

**Test scenarios:**
- All existing `event-handler.test.ts` characterization assertions (binding, dispatch order, cursor, popup open/replace/remove, `onClick`/`onHover` timing, `resetFeatureState` clearing) pass unchanged through the shared-core path.
- Covers R6/KD4. Rewrite: a **trusted** policy + `click.emit` + **no** registered handler now emits a missing-handler **warning** (was silent) and dispatch continues; a trusted policy **with** a handler dispatches to it.
- Covers R5. An **untrusted** policy + `click.emit` denies silently (no dispatch, no warn) — unchanged.
- **Security regression (fail-closed default):** end-to-end, a `MapRenderer`/`<ml-map>` path with no `capabilities` and no `hostHandlers` yields an untrusted policy and emit stays inert — a test that pins this so a future change forwarding either can't silently make emit live.
- **Security regression (popup XSS gate survives delegation):** an untrusted policy still escapes an `!html` popup marker via the shared-core `PopupBuilder`, not just denies emit.
- `resetFeatureState(layerId)` after a data refresh clears stale feature-state via the core; teardown/detach removes bindings and any open popup with no leak or double-remove.

---

### U3. Remove the R9-deferred NOTEs, changeset, docs, and file the follow-up

**Goal:** Reflect the single core in the code's own docs, ship the changeset, and file the deferred `<ml-map>` emit work.

**Requirements:** R1 (NOTE-removal half), R7.

**Dependencies:** U1, U2.

**Files:**
- `packages/core/src/interactions/attach.ts`, `packages/core/src/renderer/event-handler.ts`, `packages/core/src/interactions/built-ins.ts` (modify — remove/rewrite the three "R9 deferred / two live copies" NOTEs to describe the one shared core; the `built-ins.ts` emit NOTE now says emit is honored on the shared path but that `<ml-map>` supplies no trusted policy/handlers yet, pointing at the follow-up bead)
- `.changeset/<slug>.md` (create)
- docs: a short note that the shared core accepts the raw-event callback hook (the public-facing change is the additive callback option on `attachInteractions`)

**Approach:** Replace the "land every change in both copies" NOTEs with an accurate description of the one core. Changeset is **minor** for `@maplibre-yaml/core` (the additive callback hook on `attachInteractions`); state plainly this is an internal convergence with **no `<ml-map>` behavior change** — `click.emit` stays inert under `<ml-map>` pending the trust-surface follow-up. File a new bead for the deferred work and cross-reference it in the `built-ins.ts` NOTE and the changeset.

**Test scenarios:** `Test expectation: none — docs, changeset, and bead filing; behavior is covered by U1/U2. Verify via `pnpm presubmit` and `changeset status`.`

---

## Scope Boundaries

**In scope:** extracting the shared per-layer bind core + callback hook (U1); `EventHandler` calling it with the raw-Layer converter and threaded `policy`/`hostHandlers` (U2); the emit-inert test rewrite + security regressions (U2); NOTE cleanup, changeset, docs, follow-up bead (U3).

**Out of scope / non-goals:**
- No change to the interaction registry, the declarative config schema, or `attachInteractions`'s compiled/host-map behavior (beyond the additive callback hook and the internal extraction).
- No change to popup/highlight/flyTo/zoomToFeature behavior.
- No `<ml-map>` user-facing behavior change — `click.emit` stays inert under `<ml-map>` this bead.

**Deferred to Follow-Up Work (file a bead):**
- **Make `click.emit` live under `<ml-map>` (the original R4 end-to-end).** Needs (a) a `<ml-map>` trust surface — recommended an observed `trust` attribute the *embedder* sets (`<ml-map src=… trust="trusted">`), feeding `capabilities: { trust: "trusted" }` into `MapRenderer`; (b) a `hostHandlers` supplier bridging emitted events to a DOM `CustomEvent` on the element — recommended a single `ml-map:emit` with `detail: { event, payload }`, reusing `MapRenderer`'s existing event-forwarding and `<ml-map>`'s `setupEventForwarding`; (c) `MapRenderer` threading `hostHandlers` through to `EventHandler` (the param exists after U2); (d) a browser demo-as-test (`e2e/`) proving a trusted `<ml-map>` `click.emit` dispatches the DOM event and an untrusted one does not. This is a security-sensitive public surface — worth its own brainstorm. The follow-up must also own the direct-embedder path (a caller passing `MapRenderer` a trusted policy + `hostHandlers` directly), which becomes reachable after U2.

---

## Risks & Dependencies

- **Characterization regression (highest):** U1 is a behavior-preserving extraction and U2 a behavior-preserving delegation; the 144 renderer characterization tests + `attach.test.ts` are the safety net. Land each so the suite stays green except the single, intentional emit-inert rewrite (KD4). Do not merge U2 on a red tree.
- **The per-layer converter (KD5):** must derive `source` exactly as `EventHandler` does today and must NOT reuse `projectInteractions` (which drops emit under untrusted at projection time). A wrong converter either changes source derivation (breaking feature-state) or masks the KD3 runtime gate.
- **Fail-closed default must not silently flip:** the whole "emit inert under `<ml-map>`" guarantee rests on `MapRenderer` supplying no `hostHandlers` and `<ml-map>` passing no `capabilities`. The U2 security regression test pins this so a future change can't quietly make emit live (security-review residual).
- **mouseenter signature:** the shared core's `mouseenter` must carry the event so `onHover` gets its feature (attach's current handler drops it) — handled in U1.

---

## Verification Contract

- `pnpm presubmit` green (build → typecheck → lint → test → docs:validate-snippets), via the box test-lane.
- The 144 renderer characterization tests and `attach.test.ts` parity assertions green at every commit (characterization-first).
- `changeset status` shows the `@maplibre-yaml/core` minor bump.
- `pnpm verify:browser` still green (no new browser test this bead; existing `e2e/interactions.spec.ts` unaffected).

## Definition of Done

1. One per-layer binding implementation (the shared core); both `attachInteractions` and `EventHandler` call it (R1, KD1). The three R9-deferred NOTEs are gone/rewritten.
2. `onClick`/`onHover` fire with identical timing/arguments via the core's callback hook; the compiled path stays callback-free (R2, KD2).
3. `resetFeatureState`, popup lifecycle, cursor, and teardown behave as before through the core (R3).
4. The `emit` trust-gate is honored on the shared path: trusted+handler dispatches, trusted+no-handler warns, untrusted denies (R4 narrowed, R5); the emit-inert characterization test is rewritten with intent (R6, KD4).
5. No `<ml-map>` user-facing behavior change — `click.emit` still inert under `<ml-map>`; the fail-closed default is pinned by a regression test; the trust surface + DOM bridge + browser test are a filed follow-up bead.
6. Changeset (minor, internal convergence) shipped; `pnpm presubmit` green (R7).

## Open Questions (plan-time details)

- **OQ1 — the shared core's name and `deps` shape** (U1): e.g. `bindLayerInteractions(map, layerId, entry, deps)` vs a small factory returning per-layer handlers; the exact `deps` bundle (registry/policy/hostHandlers/popupBuilder/callbacks). Implementer's call at U1; keep the compiled path callback-free.
- **OQ2 — the raw-`Layer`→`{source, interactive}` converter placement** (U2, KD5): a private helper in `event-handler.ts` vs a shared exported helper. It must match `EventHandler`'s current source derivation exactly and must not reuse `projectInteractions`.
- **OQ3 (carried, now a follow-up)** — the `<ml-map>` trust surface shape (attribute vs property) and the `ml-map:emit` `detail` shape are the deferred bead's decisions, not this one.
