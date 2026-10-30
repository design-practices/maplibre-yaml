---
"@maplibre-yaml/core": patch
---

A `__proto__` or `constructor` key where the document has no such key now gets the "Unknown key" warning, at the root or nested, in YAML, JSON and TOML. Before, the unknown-key check took both for known keys (they named JavaScript's own object properties), so a key there, typo or not, was passed over in silence. Neither key reaches the validated document or any shared object prototype, as before.
