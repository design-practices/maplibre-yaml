---
"@maplibre-yaml/core": patch
---

Validation messages for the most common YAML mistakes now name the field and the fix, both on the error card and in `mlym validate`:

- A misspelled required key is reported as the typo: `config.centre: Unknown key "centre" — did you mean "center"?` instead of `config.center: Expected array, got undefined`. Letter-case slips (`Zoom`) and one-letter typos (`zom`) work too. Separate `lat:`/`lng:` keys get the `center: [longitude, latitude]` form. A British-spelling or letter-case variant of an optional `config` key (`mapstyle`, `bearIng`) now warns.
- An unquoted hex colour (`circle-color: #ef4444`, which YAML reads as a comment) reports `Colours starting with # must be quoted: circle-color: "#ef4444"` at its line. In a flow map, where it is a YAML syntax error, the error gets the same hint.
- A failure inside a layer reports the inner field instead of `layers.0: Value does not match any of the expected formats`. For example: `layers.0.paint.circle-radius: Expected number or array, got string. Write a plain number, without quotes or units: 10`.
- Swapped coordinates (`center: [39, -98]`) suggest `[-98, 39]`. `type: Map` says values are case-sensitive.
- A layer `source:` that almost names a declared source (`citeis` for `cities`) warns with a did-you-mean.
