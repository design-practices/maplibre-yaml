---
"@maplibre-yaml/astro": patch
---

`<Map src>` and `<FullPageMap src>` now work on a site deployed under a base path, such as a GitHub Pages project site (`base: '/my-repo'`). A root-relative `src="/configs/map.yaml"` is prefixed with the site's base, so it loads `/my-repo/configs/map.yaml` instead of 404ing; a `src` that already includes the base, or a full `https://` URL, is used as written. The new "Deploying to GitHub Pages" docs section covers the rest of a subpath deploy.
