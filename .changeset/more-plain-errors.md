---
"@maplibre-yaml/core": patch
---

More validation errors are worded in plain language, the same in the browser's error card and in `maplibre-yaml validate`:

- `center: -73.982, 40.743` (no brackets) says `center needs square brackets: center: [-73.982, 40.743]`, not `Expected array, got string`. The same goes for a marker's `at:`.
- A value outside a fixed list (`alignment: middle`) lists the allowed values and suggests the likely one: `"middle" is not one of left, right, center, full. Did you mean "center"?`.
- A `"` inside a `"…"` value is explained at its line (it ends the value early; use single quotes around the value, or write `\"`). It used to read `Unexpected scalar at node end`.
- A document whose `type:` line is missing says `The document is missing type: at the top — add type: scrollytelling` (or `type: map`, going by the document's shape) wherever it is checked.
- One mistake gives one message. A `centre:` typo is reported once, not again as an unknown `config:` key.

Code that shows errors to readers can use the new `displayPath()` helper. It leaves out the 0-based `chapters.3` path when the message already names the chapter (`Chapter 4 ("brooklyn-bridge") …`); the `path` itself is unchanged for tools. This is an additive change; existing code needs no action.
