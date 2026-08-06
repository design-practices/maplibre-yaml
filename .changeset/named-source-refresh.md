---
"@maplibre-yaml/core": minor
---

Make named sources first-class: live refresh, shared `updateData`, and `$ref` resolution in standalone blocks (schema-truthfulness U7).

**Named sources now refresh.** `MapRenderer` used to call `map.addSource` directly for block-level `sources:`, which bypassed every piece of refresh machinery — a named source could declare `refresh:` and never poll — and leaked YAML-only keys (`refresh`, `cache`, `prefetchedData`, the legacy top-level refresh fields) straight into the spec MapLibre validates. Registration moves to `LayerManager`, which scrubs those keys and owns one pipeline per source id, reference-counted: two layers over one source poll once, removing one keeps it running, removing the last stops it. `data-loaded`/`data-error` still fire per referencing layer, so a consumer listening on its own layer sees what it always did.

**`updateData` reaches named sources.** It resolved a hardcoded `<layerId>-source`, which does not exist for a layer over a named source — so the update silently did nothing. It now resolves through the layer→source map. Updating through one layer is visible to every layer sharing that source; that is documented behaviour, not an accident. `pauseRefresh`, `resumeRefresh`, `refreshNow`, and `disconnectStream` stay layer-keyed and resolve to the shared pipeline, so callers never need to know which source shape they configured.

**`$ref` sources resolve in standalone blocks.** `{$ref: "#/sources/x"}` in a `type: map` block — the flagship `<ml-map src>` path — survived parsing untouched, so the renderer saw a source with no `type` and silently added nothing: a config that validated and drew no layer. Standalone blocks now resolve refs against their own `sources:` record. Nested recursive `$ref` remains out of scope.
