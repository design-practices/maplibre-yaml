---
"@maplibre-yaml/astro": patch
---

Widen the `@maplibre-yaml/core` peer range to span the whole 0.x line
(`>=0.3.0 <1.0.0`).

The range was enumerated major-by-major (`^0.2.0 || ^0.3.0`), so every
core minor fell outside it. Changesets bumps a peer dependent to a new
**major** whenever its peer moves out of range, which is how the 0.4.0
release staged `@maplibre-yaml/astro` at 1.0.0 off nothing but a
dependency update — a 1.0 the package is not ready to make. A range that
covers 0.x keeps core's minors in range, so astro versions on its own
changes from here rather than on core's.

No behavior change: astro's code is untouched, and the published range
still refuses a future core 1.0, which would be a real compatibility
boundary.
