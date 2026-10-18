---
"@maplibre-yaml/core": patch
---

Plainer wording for common YAML and validation errors. An indentation slip no longer reads "Nested mappings are not allowed in compact mappings" at the line above the mistake. It now names the line to fix and both columns: `YAML indentation error: Line 97 is indented differently from line 96 above it: "title:" starts in column 6, but "id:" starts in column 5…`. A value containing `: ` is told to use quotes. A missing required key says so and shows what to add (`Chapter 4 ("brooklyn-bridge") is missing center: — add center: [longitude, latitude].`) instead of `Expected array, got undefined`. Every error inside a chapter now names the chapter as the author counts it, from 1 and by id. The error `path` (`chapters.3.center`) is unchanged for tools.
