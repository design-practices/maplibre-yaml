---
"@maplibre-yaml/core": patch
"@maplibre-yaml/cli": patch
---

An integer too large for a JavaScript number to keep exactly now warns where it is written. Past 2^53 a number no longer holds every integer, so a feature id written `12345678901234567890` was read, silently, as `12345678901234567000`, and two ids that differ only in their last digits could become one. The warning names the digits as written and as read and says to write the id as a string, at the key's line and column (at the element, inside a list). In TOML every parse warns, so `<ml-map>`, `mlym validate` and the playground all show it. In YAML and JSON, `mlym validate` warns (in every output format) and the browser does not: the check is the new core export `bigIntegerWarnings(text)`, which tooling calls and the elements don't, so the CDN build doesn't carry it. Integers a number keeps exactly, including 2^53 itself, give no warning. It is a note, not a problem warning: `mlym validate --strict` (on by default in CI) still passes a document that has one, so no build that passed before this patch fails because of it.
