---
"@maplibre-yaml/core": minor
---

Validate the JSON-attribute and programmatic config paths (schema-truthfulness U9).

`<ml-map>` validated configs that arrived as YAML — from an inline `<script>` or a `src` URL — but not those that arrived as an object. The `config` attribute and the programmatic `.config` setter went straight from `JSON.parse` to the renderer, so a well-formed object that failed the schema produced a broken map with no error card, no console warning, and no clue as to why. That is the same accepted-but-doesn't-work shape the rest of this release closes, on the entry paths least likely to be exercised in testing.

Both now route through `YAMLParser.safeParseMapBlockValue`, so every entry point produces the same diagnostics: schema failures render the error card, unknown keys get did-you-mean suggestions, and deprecated fields warn. Positions are omitted for object input, since a line number would refer to text the caller never wrote.

One consequence worth noting: **schema defaults now apply on these paths**, as they always have on YAML. A `legend:` supplied via the `config` attribute comes back with `collapsed: false` filled in. The two entry points previously produced different configs from identical input; they no longer do.
