---
"@maplibre-yaml/core": minor
---

Wire `click.flyTo` to the camera (schema-truthfulness U4). The field has been in the layer schema — with a documented example — since interactivity shipped, but the click handler never read it: configuring `flyTo` validated cleanly and did nothing. Clicking an interactive layer now animates the camera, defaulting the center to the clicked point and honoring `center`, `zoom`, and `duration`.

Click dispatch is now **registry-shaped**, in a new internal `renderer/interactions.ts`: interactions are named entries (`popup`, `flyTo`) pairing a `select` (where the config lives) with a `run` (what it does), dispatched in registry order rather than through a chain of `if` branches in the click handler. Popup runs before flyTo, so a layer configuring both opens the popup at the clicked point and lets it travel with the camera. Adding an interaction means adding an entry, and the module is scoped so the planned interactions-package extraction moves it wholesale.

An interaction is considered configured only when its selected config is truthy, so a present-but-disabled value (the shape `hover.highlight: false` takes) does not run. `flyTo` omits `zoom`/`duration` when unset so MapLibre's defaults apply, and both accept `0` as a meaningful value.

These symbols are internal — deliberately absent from the package barrel. Extensibility remains eject-to-JS plus slots, not a plugin registry.

Multi-feature clicks continue to resolve to the topmost feature, and the `layer:click` event still fires for every click regardless of which interactions are configured.
