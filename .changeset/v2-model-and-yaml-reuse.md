---
"@maplibre-yaml/core": minor
"@maplibre-yaml/astro": minor
---

Add the v2 internal model, enable YAML merge keys, and accept `state:`/`parameters:`.

**YAML-native reuse.** Merge keys (`<<: *base`) now resolve, at every map-document parse site in core and in the Astro loader. Previously the `<<` key survived parsing as a literal, so the anchored content never merged and the stray key tripped unknown-key validation — a silent wrong answer for standard YAML. Anchors and aliases already worked and are now documented, in a new "Reusing values and blocks" guide covering the shallow-merge behavior that surprises people.

Merge fan-out is bounded. The YAML library's alias-expansion budget does not count merge keys, so enabling them opened an expansion vector: measured, a 338-byte document took 13 seconds and grew exponentially. Fan-out is now refused in both spellings — a sequence value (`<<: [*a, *b]`) and the merge key repeated in one mapping — while single-alias chains, which are linear and are what the guide teaches, stay legal to any depth.

**`state:` and `parameters:` are authorable** at the document root, where format v2 places them, so early adopters have nothing to move later. `state` is a style-spec root property that compiles through; `parameters` carries the label/type/range metadata a control UI needs and does not. `global-state` is registered as a known expression operator — without it the first document to use the feature would warn on every expression, and `mlym validate` promotes warnings to errors under CI.

**A new internal model** (`normalizeMapBlock` and friends, exported from the package root) splits a document into the half that compiles to `style.json` and the half that does not. `<ml-map>` renders through it. This is the shape the forthcoming `style.json` emitter is written against; it changes no rendering behavior.

**Also fixed:** an anchor-expansion attack previously escaped `safeParse*` as an uncaught exception rather than returning errors, on every entry point including the one `mlym validate` and the preview server use — for an API whose contract is "returns errors, never throws", on the input class most likely to be hostile.
