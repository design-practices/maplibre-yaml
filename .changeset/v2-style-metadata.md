---
"@maplibre-yaml/core": minor
---

Compile format-v2 `style.metadata` through to the emitted `style.json` root
(ml-tay). The v2 schema accepted `style.metadata` but the reader had no model
slot for it and dropped it silently — a never-drop-discipline gap. It now lands
on the model's style half and the emitter writes it to the style-spec root
`metadata` property, so authored style metadata survives eject. It has no v1
surface (v1 `config.metadata` is a `Map` option under `runtime.map`), so it is
not an AE2 pair and cannot cause a v1/v2 divergence.
