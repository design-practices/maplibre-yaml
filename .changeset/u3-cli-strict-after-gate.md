---
"@maplibre-yaml/cli": patch
---

`mlym emit --strict` now fails when the runtime gate degrades lossily —
previously a state-using document emitted with `--strict --target 4.0.0`
inlined its `state:` defaults (a lossy transformation) and still exited 0,
because strictness was only enforced over the projection stage. Strict now
means strict over the whole pipeline.
