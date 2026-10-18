---
"@maplibre-yaml/core": patch
---

When `base` is set on `<ml-map>` or `<ml-scrollytelling>` and a file under it is not found, the error card (and the data notice) now explains `base` instead of giving page-relative path advice that does not apply. Previewing a GitHub Pages site with `base="/my-repo/"` from inside the repo folder (so the page is at `/`) now says the page is outside `/my-repo/` and to either remove `base` while developing or serve the folder one level up and open `/my-repo/`, noting that the folder must be named like the base (a GitHub "Download ZIP" folder is called `my-repo-main`). A page served at the base without its trailing slash (`/my-repo`, as `astro dev` and `npx serve` do) counts as inside it. With `base="/"` (what the Astro components pass on a site at the root) the card says paths start at the site root (`public/`) rather than quoting `base="/"`, and a base on another site gets no local-preview advice.
