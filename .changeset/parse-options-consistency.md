---
"@maplibre-yaml/core": minor
---

Make the library's canonical YAML parse options a supported public export
(ml-0fg, PR #74). `YAML_PARSE_OPTIONS` and `htmlTag` are now exported (frozen)
from `@maplibre-yaml/core` so a consumer that parses YAML itself parses exactly
as the library does instead of re-declaring the options and drifting.
