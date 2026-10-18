---
"@maplibre-yaml/astro": patch
---

`<Map src>` and `<FullPageMap src>` now work on a site deployed under a base path, such as a GitHub Pages project site (`base: '/my-repo'`). A root-relative `src="/configs/map.yaml"` is prefixed with the site's base, so it loads `/my-repo/configs/map.yaml` instead of 404ing; a `src` that already includes the base, or a full `https://` URL, is used as written. URLs inside the YAML document are not rewritten: write the base into paths to your own files (`url: "/my-repo/data/points.geojson"`), as the new "Deploying to GitHub Pages" docs section explains.
