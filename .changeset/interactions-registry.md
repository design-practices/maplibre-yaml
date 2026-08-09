---
"@maplibre-yaml/core": minor
---

Interactions ship as a registry-backed module with a standalone
`attachInteractions` entry point (ml-cbm, PR #73). The declarative interactions
(popup, highlight, zoom-to-feature, emit) can now be wired onto **any**
`maplibregl.Map` — a bare compiled `style.json`, or a map the host already owns
— not just a map the library rendered. Because the emitter strips the runtime
half, a compiled style renders but is inert; `attachInteractions` reattaches the
behavior over it, so interactions survive eject. Popup `!html` stays
capability-gated and emit stays trust-gated and closed-world.
