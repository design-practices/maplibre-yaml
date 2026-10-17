---
"@maplibre-yaml/core": patch
---

Colour values are now checked against the CSS colour names maplibre-gl knows. `circle-color: "bleu"` used to validate and then drop the whole layer at runtime, with the reason only on the console. It is now a validation error: `"bleu" is not a colour name. Did you mean "blue"?`. A colour pasted with curly quotes (`“#ef4444”`) says to retype them as straight quotes. Four-digit hex (`#rgba`) is now accepted, as maplibre-gl does. Other CSS functions (`var(--accent)`, `oklch(…)`) are still accepted in the fields that render as CSS, such as legend swatches and marker pins.
