---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
bead: ml-wx2
title: "Converge the interaction binding onto one path (R9) - Plan"
date: 2026-08-09
---

# Converge the interaction binding onto one path (R9) - Plan

**Bead:** ml-wx2 · **Source:** ce-brainstorm (2026-08-09) · **Deferred from:** ml-cbm (U5, PR #73)

## Goal Capsule

- **Objective:** Collapse the two hand-maintained copies of the interaction `map.on` binding + dispatch logic into one path, and — riding along — make `click.emit` actually work under `<ml-map>`, which it currently does not.
- **Product authority:** This document (the WHAT). `ce-plan` owns the HOW.
- **Open blockers:** None. Parity between the two paths is already proven green (`attach.test.ts`), which is the gate that deferred this work out of ml-cbm.

## Problem Frame

`attachInteractions` (`packages/core/src/interactions/attach.ts`) and the live renderer's `EventHandler` (`packages/core/src/renderer/event-handler.ts`) are **two live copies** of the same logic: the per-layer `map.on(click/mouseenter/mouseleave/mousemove)` binding, the `select`-ordered dispatch, and the cursor handling. `attachInteractions` was built in ml-cbm to wire declarative interactions onto any `maplibregl.Map` (including a compiled `style.json`); the working renderer kept its own `EventHandler` rather than being forced through the then-unproven attach path (three review lenses warned against it). Both files carry a NOTE documenting the duplication and instructing that any change land in both.

Two costs follow from the split:

1. **Drift risk.** Every change to what is bound, dispatch order, or how the interaction context is built must be made twice, by hand, forever.
2. **A live gap.** `click.emit` is **inert under `<ml-map>`**: `EventHandler` does not thread `policy`/`hostHandlers` into its interaction deps, so `emit` resolves every event to a denial and dispatches nothing — even for a trusted document (see the NOTE in `built-ins.ts`). `emit` works only on the attach path.

The enabling insight: `attachInteractions` is already the **more complete** implementation — it threads `policy`/`hostHandlers`, and already has `resetFeatureState` and cursor handling. `EventHandler`'s only genuine extras are the renderer's `onClick`/`onHover` host callbacks and its class lifecycle. So convergence is mostly deletion, and the emit gap closes as a consequence rather than as separate work.

## Key Decisions

- **KD1 — `EventHandler` becomes a thin shell over `attachInteractions`.** One binding path; `attachInteractions` is the core. `EventHandler` keeps its class shape and `onClick`/`onHover` API (so the renderer / `<ml-map>` wiring is untouched and the 144 characterization tests protect a minimal-churn change), but its body becomes: construct `attachInteractions`, hold the handle, delegate `resetFeatureState`/teardown. No new shared abstraction is introduced. *(Rejected: deleting `EventHandler` and calling `attachInteractions` directly from the renderer — more churn into the component layer for one fewer type; and extracting a third shared "bind-core" both call — keeps two entry types and adds an abstraction.)*
- **KD2 — `attachInteractions` gains an optional raw-event callback hook** to carry the renderer's `onClick`/`onHover`. These fire on **every** click/hover on a layer, independent of interaction dispatch, so they compose as a notification layer on the shared path and must not leak into the compiled-map path (the hook is opt-in; the compiled path passes none).
- **KD3 — `click.emit` goes live under `<ml-map>` (a deliberate behavior change).** Threading `policy`/`hostHandlers` through the shared path makes `emit` capable under the renderer. The host receives emitted events as a **DOM `CustomEvent`** dispatched on the `<ml-map>` element (matching the existing `ml-map:load` / `ml-map:error` convention); a host listens with `addEventListener`. The closed-world security property is preserved by the **trust gate** — an untrusted document still cannot emit (`allowsHostHook`) — and DOM events are opt-in-by-listening. *(Rejected: a programmatic `hostHandlers` property on the element — less idiomatic for a web component; and deferring the host surface — the user chose to land it here.)*

## Requirements

- **R1.** There is exactly one implementation of the `map.on` binding, the `select`-ordered dispatch, and the cursor handling. `EventHandler` no longer re-implements them; it delegates to `attachInteractions` (KD1). The duplication NOTEs in `attach.ts`, `event-handler.ts`, and `built-ins.ts` are removed or updated to reflect the single path.
- **R2.** The renderer's `onClick`/`onHover` callbacks fire with identical timing and arguments as today, via the new callback hook (KD2). They remain a renderer-only concern and do not appear on the compiled-map (`attachInteractions`-direct) path.
- **R3.** `EventHandler`'s renderer-only lifecycle is preserved through delegation: `resetFeatureState(layerId)` (live-data stale-state clearing), popup lifecycle, cursor management, and teardown all behave as before.
- **R4.** `click.emit` works under `<ml-map>` for a **trusted** document: the configured event dispatches to the host as a DOM `CustomEvent` on the element, carrying the emit payload (KD3).
- **R5.** `click.emit` remains **denied** under `<ml-map>` for an **untrusted** document — no DOM event fires — preserving the trust model (`allowsHostHook`). The closed-world guarantee (an unknown/prototype event name never dispatches) is not weakened.
- **R6.** The 144 renderer characterization tests pass **throughout** the change (characterization-first — they are the safety net), and `attach.test.ts`'s parity assertions stay green. Any existing test that asserts "`emit` is inert under the renderer" is updated with intent (it is now the R4/R5 behavior).
- **R7.** The change ships a changeset (behavior change: `emit` no-op → live under `<ml-map>`) and the emit-under-`<ml-map>` behavior is documented (the new DOM event + the trusted-only condition).

## Scope Boundaries

**In scope:** the binding convergence (R1–R3); making `emit` live under `<ml-map>` via a DOM `CustomEvent` (R4–R5); characterization-protected sequencing (R6); changeset + docs (R7).

**Out of scope / non-goals:**
- No change to the interaction registry, the declarative interaction config schema, or the behavior of `attachInteractions` on the compiled/host-map path (beyond the additive callback hook).
- No change to popup / highlight / flyTo / zoomToFeature behavior.
- No new emit *features* (payload shape beyond what exists, event filtering, etc.).
- The write seam (ml-0fg) and sugar provenance (ml-0fg.2) are unrelated.

## Success Criteria

- One binding path; a change to dispatch order or bound events is now made once.
- 144 renderer characterization tests + `attach.test.ts` parity green at every commit.
- A trusted `<ml-map>` document with `click.emit` dispatches a DOM `CustomEvent` a host can listen for; an untrusted one dispatches nothing.

## Open Questions (plan-time details)

- **OQ1 — DOM event shape.** Recommended default: a single `ml-map:emit` event with `detail: { event, payload }` (host filters on `detail.event`), rather than dynamically-named `ml-map:<event>` events — one listener, no unbounded event-name surface. `ce-plan` to confirm the exact event name and `detail` shape.
- **OQ2 — callback-hook signature.** The raw-event hook that carries `onClick`/`onHover` — exact option name/shape on `AttachInteractionsOptions` — is a `ce-plan` detail; it must keep the compiled path callback-free by default.
- **OQ3 — `<ml-map>` default trust policy.** `emit` only fires for a trusted document. Whether/how an `<ml-map>` document is trusted is the existing policy model and is not changed here; the plan should note the practical consequence (a default-untrusted `<ml-map>` still won't emit until the host opts the document into trust) so the behavior change isn't over-promised.
