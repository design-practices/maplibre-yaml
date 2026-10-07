---
"@maplibre-yaml/core": patch
---

Scrollytelling documents no longer get false "not implemented" warnings. The chapter fields `spinGlobe`, `rotateAnimation` and `callback`, and the chapter actions `fitBounds`, `custom`, `flyTo` and `easeTo`, all run in `@maplibre-yaml/astro`'s `<Scrollytelling>` as of this release, but validation still warned that each was accepted by the schema and had no effect, which told authors to remove working fields. Those warnings are gone, and the `spinGlobe` schema description and docs now say what it does.
