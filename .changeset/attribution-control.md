---
"@maplibre-yaml/core": minor
---

Make `controls.attribution` render a real attribution control (schema-truthfulness U3). Previously the field validated but did nothing at runtime — the first of the "accepted but dead" fields the 0.4.0 truthfulness work closes.

`ControlsManager` gains an attribution branch (default position `bottom-right`) that constructs MapLibre's `AttributionControl`, exported through the maplibre-gl interop shim. When `controls.attribution` is configured, the map is constructed with `attributionControl: false` so MapLibre's built-in attribution does not double-render; the default still appears when the control is absent. An explicit `config.attributionControl: true` conflicting with `controls.attribution` resolves in favor of the control with a console warning.

The attribution control config now accepts `compact` and `customAttribution` passthrough options (previously stripped as unknown keys), so they reach the constructed control.
