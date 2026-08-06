---
"@maplibre-yaml/core": minor
---

Implement `hover.highlight` (schema-truthfulness U5). The field validated and did nothing: hovering a feature now visibly highlights it.

Highlighting is driven by `mousemove` rather than `mouseenter`, because MapLibre fires `mouseenter` once when the pointer enters a layer, not once per feature — so it cannot tell which feature is under the cursor as you move across them. The hovered feature gets `{ hover: true }` feature-state, the previous one is unset, and state is released on mouseleave, `detachEvents`, and `destroy`, so nothing stays lit.

**Paint is rewritten so the state is visible.** Feature-state alone changes nothing on screen, so the layer's primary colour (`circle-color`, `line-color`, `fill-color`, `fill-extrusion-color`, `text-color`) is wrapped in a `case` on `["feature-state", "hover"]`. Only a plain literal colour is rewritten: an authored expression is left untouched and warned about, since overwriting it would silently discard data-driven styling. Layer types with no per-feature colour warn that highlight does not apply.

**Sources without ids opt into generated ids.** Feature-state is addressed by feature id, so a geojson source with neither `generateId` nor `promoteId` has `generateId` enabled with a warning noting that generated ids are not stable across data refreshes and that `promoteId` is the durable choice.

The interaction registry introduced for `click.flyTo` grows to carry state: an interaction now builds a per-`EventHandler` runtime, so `highlight` owns its tracked-feature bookkeeping and its own cleanup instead of leaking either into the event handler. `popup` and `flyTo` are unchanged in behavior.

Known caveat: feature-state is per source, so two layers sharing one source share highlight state — highlighting a feature in one can restyle it in the other if both use feature-state paint.
