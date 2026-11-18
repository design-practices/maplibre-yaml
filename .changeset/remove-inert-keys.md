---
"@maplibre-yaml/core": minor
"@maplibre-yaml/cli": patch
"@maplibre-yaml/astro": patch
---

Four keys that were accepted but did nothing (and warned "has no effect" since 0.9.1) are now errors that say what to write instead.

- **`fetchStrategy: build` / `hybrid`** on a GeoJSON source fails validation: maplibre-yaml fetches a source's data in the browser when the map loads, and nothing ever fetched at build time. To inline data fetched elsewhere (at build time, by a script), write it under `prefetchedData:` — the Astro loader fills it for you. `fetchStrategy: runtime` stays accepted for one more release, as a deprecation warning: it names what always happens, so remove it.
- **Multi-page `pages:` documents** (with their `content`, `mixed` and `map-fullpage` blocks, and the root `config.theme` and `config.dataFetching` that only existed there) fail with one error: "Multi-page documents (pages:) are not supported: write one document per page (type: map or type: scrollytelling); Astro and the web component compose pages." No package ever rendered one. A story's own `theme:` is unchanged.

With the document go its entry points and schemas: `YAMLParser.parse`, `safeParse` and `validate` (the root-document parsers), the `parseYAMLConfig` / `safeParseYAMLConfig` aliases, `RootSchema`, `PageSchema`, `BlockSchema`, `MixedBlockSchema`, `ContentBlockSchema`, `MapFullPageBlockSchema` and their types, and `safeParseAny`'s `blockType: "root"` variant. `YAMLParser.resolveReferences` stays (a map's `source: { $ref: "#/sources/name" }` still resolves against its own `sources:`). `GlobalConfigSchema` stays for the Astro integration's `loadGlobalMapConfig`, without `theme` and `dataFetching`. The hosted `root.schema.json` is no longer emitted, and `any.schema.json` is a `oneOf` over the map and scrollytelling shapes.

CLI: `mlym validate` exits 1 on a `pages:` document with that one error; `mlym schema root` is gone (`map`, `scrollytelling`, `any` remain).
