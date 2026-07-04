---
"@maplibre-yaml/astro": minor
---

Track `@maplibre-yaml/core` 0.3: the peer dependency range is now an explicit `^0.2.0 || ^0.3.0` (previously `workspace:^`, which forced spurious major bumps in the release tooling and pinned consumers to a single core minor at publish time). The astro package uses core's runtime-inheritance fixes shipped in 0.3.0.
