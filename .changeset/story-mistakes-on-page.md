---
"@maplibre-yaml/core": patch
---

More mistakes are now explained on the page, not only in the console. A document-level key written inside `config:` (for example `markers:` or a story's `theme:`) is listed in the map's notice with its line. A chapter whose `layers.show`/`layers.hide` or action names a layer the map doesn't have says so, with a did-you-mean, when the chapter runs; before, the layer silently never appeared. A chapter image or video that fails to load replaces the broken image with a note naming the file and reminding that capital letters count on GitHub Pages. `ValidationWarning` gains an optional `onPage` flag (warnings that are also shown on the page); this is an additive change and needs no action.
