---
"@maplibre-yaml/core": patch
---

More mistakes are now explained on the page, not only in the console. A document-level key written inside `config:` (for example `markers:` or a story's `theme:`) is listed in the map's notice with its line. A chapter whose `layers.show`/`layers.hide` or action names a layer the map doesn't have says so, with a did-you-mean, when the chapter runs; before, the layer silently never appeared. A chapter image or video that fails to load is replaced by a short note. Visitors read one plain line ("This chapter's image couldn't load."). The file name and the reminder that capital letters count sit under "Details for the site's author", which is open while the page is served from your own computer and closed on a published site. `ValidationWarning` gains an optional `onPage` flag (warnings that are also shown on the page); this is an additive change and needs no action.
