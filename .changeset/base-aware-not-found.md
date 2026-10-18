---
"@maplibre-yaml/core": patch
---

When `base` is set on `<ml-map>` or `<ml-scrollytelling>` and a file under it is not found, the error card (and the data notice) now explains `base` instead of giving page-relative path advice that does not apply. Previewing a GitHub Pages site with `base="/my-repo/"` from inside the repo folder (so the page is at `/`) now says: "This page sets base="/my-repo/", so files are looked up under /my-repo/ — but the page itself is at /, outside /my-repo/. If you're previewing locally, serve the parent folder so this page opens at /my-repo/, or remove base while developing." On a page that is under the base, the card says every path is looked up under the base rather than next to the page.
