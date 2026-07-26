---
"@maplibre-yaml/core": minor
---

Bring the published contract in line with what the renderer now does (schema-truthfulness U10).

**Deprecated fields are annotated.** The emitted JSON Schemas mark `click.action`, `mouseenter.action`, `mouseleave.action`, and the legacy top-level `refreshInterval`/`updateStrategy`/`updateKey` with `deprecated: true`, driven by the same constants the runtime validator uses so the two cannot drift. Editors grey these out and agents generating configs can avoid them — until now nothing in the published contract distinguished a field that works from one that is accepted and does nothing.

**The interactivity docs described the opposite of reality.** The page stated that "the schema doesn't explicitly define event handlers (as they're runtime JavaScript)" and showed readers how to hand-author `feature-state` paint expressions "when implemented in the runtime renderer". The schema has always defined `interactive.click.popup` and `hover.cursor`, and this release added `click.flyTo` and `hover.highlight` — which writes that paint expression for you. Rewritten to document the real `interactive:` block, including the id requirements `highlight` carries, the deprecated `action` fields and the events that replace them, and how to keep authoring your own highlight paint if you want the control.

Also documents the `attribution` control's `compact` and `customAttribution` options, live refresh on a named source (one poll shared across referencing layers, and what `updateLayerData` does to siblings), and `$ref` source references.
