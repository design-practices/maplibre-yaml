---
"@maplibre-yaml/core": patch
"@maplibre-yaml/astro": patch
---

Global config inheritance now actually flows into built map configs.

**Astro map builders respect `globalConfig.defaultZoom`.** All six builders (`buildPointMapConfig`, `buildMultiPointMapConfig`, `buildPolygonMapConfig`, `buildRouteMapConfig`, `buildMultiPolygonMapConfig`, `buildMultiLineStringMapConfig`) previously hardcoded a zoom fallback (`zoom ?? location.zoom ?? 12`, or a literal `10`/`12`) that fired *before* `resolveMapConfig` could apply the global default — so setting `defaultZoom` in your global config had no effect on built maps. Zoom now resolves as: explicit option > `location.zoom` (point builder) > `globalConfig.defaultZoom` > builder default. Behavior without a global config is unchanged: the builders' built-in defaults (12 for point/polygon, 10 for bounds-fitted builders) still apply as the last resort, so no existing call site starts throwing. `defaultCenter` and `defaultMapStyle` inheritance continue to be handled by core's `resolveMapConfig`, with explicit values always winning.

**Core `resolveMapConfig` no longer uses an unsafe `as MapConfig` cast.** The return value is now structurally verified by TypeScript via narrowed locals after the missing-fields guard, so if a new required field is ever added to `MapConfig`, the resolver fails to compile instead of silently passing invalid data. Runtime behavior (resolution precedence, `ConfigResolutionError` on missing `mapStyle`/`center`/`zoom`) is unchanged.
