---
"@maplibre-yaml/core": minor
---

`emit` is now a hover interaction as well as a click one (ml-fn9). A layer's
`hover: { emit: { event, payload } }` dispatches the named host event once per
feature *entered* — per-feature deduped (mirroring `highlight`), driven by
`mousemove`, so it fires when the pointer enters a new feature rather than on
every pointer move. It shares the exact trust gate and closed-world
host-handler resolution as click-emit (one `dispatchEmit` seam), so an untrusted
document's `hover.emit` is denied just like `click.emit`, and — like all `emit`
— it is inert under `<ml-map>` until the deferred trust-surface follow-up. Hover
dedupe needs a feature id; a source without one gets a one-time warning pointing
at `generateId`/`promoteId` rather than a per-move firehose.
