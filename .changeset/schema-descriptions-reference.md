---
"@maplibre-yaml/core": patch
---

Every user-facing schema key now carries a description, so editor hover docs (via the published JSON Schema) and the new generated YAML reference on the docs site are never blank. Newly described: the GeoJSON source's `tolerance`, `buffer`, `lineMetrics`, `generateId`, and `promoteId`; `promoteId` on vector sources and `volatile` on vector/raster/raster-dem sources; `interactive.click.flyTo.center`/`zoom`/`duration` (whose `zoom` previously inherited the unrelated "Minimum zoom level" text); and the legacy `interactive.mouseenter`/`mouseleave` triggers. `parameters.<key>.type` now lists the control kinds the params panel understands (`enum`/`select`, `range`, `toggle`) and how it infers one when omitted. Validation behavior is unchanged.
