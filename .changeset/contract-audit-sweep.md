---
"@maplibre-yaml/core": patch
"@maplibre-yaml/cli": patch
---

Renderer/schema contract audit: schema-valid documents now render or fail
loudly, never silently. Four observable changes: (1) legend `collapsed:`
is implemented — the legend renders as a native `<details>` with the title
as its toggle, starting closed when `collapsed: true` (the field previously
did nothing; an untitled legend gets a "Legend" summary). (2) Schema-accepted
fields the engine does not implement yet (scrollytelling `spinGlobe`,
`rotateAnimation`, `callback`, and the `fitBounds`/`custom`/`flyTo`/`easeTo`
chapter actions) now emit `kind: "unimplemented"` warnings — visible in
`mlym validate` output but never promoted to errors, since the document is
not wrong. (3) `<ml-map>` logs render errors to the console in addition to
dispatching `ml-map:error`, so a document failure is visible without a
listener; a throw during named-source registration is now routed to that
error path instead of being swallowed inside MapLibre's load handler.
(4) A layer whose source object the renderer cannot resolve (an unresolved
`$ref` passed programmatically, or an unknown source shape) throws a clear
error naming the layer instead of silently adding nothing.
