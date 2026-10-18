---
"@maplibre-yaml/astro": minor
---

`Map` and `FullPageMap` now put the paths inside your YAML under your site's `base`, so a site deployed to a GitHub Pages project site (`base: '/my-repo'`) works without writing the repo name into the YAML: `url: "/data/volcanoes.geojson"`, `images:` and marker `icon:` paths load from `public/` under `/my-repo/`. The components pass `import.meta.env.BASE_URL` to `<ml-map>` as its new `base` (needs `@maplibre-yaml/core` 0.8). Paths that already include the base keep working.

**Behaviour change:** the base is passed even when it is the default `/`, so a relative path in a document (`data/x.geojson`) now means "from `public/`" on every page. Before, it resolved against the page, so on a nested page such as `/blog/post/` it asked for `/blog/post/data/x.geojson`. Paths that start with `/` and full URLs behave as before on a site without a `base`. A new `base` prop overrides the value; `base={false}` restores the old page-relative resolution for that map.
