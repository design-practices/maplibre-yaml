# @maplibre-yaml/cli

## 0.1.13

### Patch Changes

- 8511427: The CLI now validates and previews every block type it scaffolds, and preview renders with the locally installed core instead of a stale CDN pin.

  **core: new `YAMLParser.safeParseAny(yaml)` block dispatcher (also exported as `safeParseAny`).** Core exposed `safeParseMapBlock` / `safeParseScrollytellingBlock` / `safeParse` but no "detect `type:` and validate" entry point, so every consumer had to guess which schema a document needed. `safeParseAny` dispatches on the document's top-level `type:` field (`map` → MapBlockSchema, `scrollytelling` → ScrollytellingBlockSchema, no `type:` but `pages:` → RootSchema) and returns a discriminated `{ blockType, result }`. An unrecognized `type:` produces a clear error listing the valid values instead of a cryptic literal mismatch. Never throws.

  **cli: `validate` accepts everything `init` scaffolds.** `mlym validate story.yaml` on the CLI's own story template (`type: scrollytelling`) failed with a type-literal error because the validator called `safeParseMapBlock` unconditionally; root `pages:` documents were equally unsupported. Both now validate via `safeParseAny`. Exit-code semantics are unchanged.

  **cli: `preview` serves the locally installed core.** The preview page's import map hardcoded `https://esm.sh/@maplibre-yaml/core@0.1.2/dist/register.js` — preview rendered with a core two minors behind the one that validated the config. Preview now resolves the installed `@maplibre-yaml/core` and serves its browser register bundle through the dev server; only if local resolution fails does it fall back to esm.sh pinned to the _installed_ version read from the package's own package.json. Previewing a non-map document (e.g. the story template) now shows "visual preview currently supports only `type: map` blocks" instead of a misleading validation error, and the error overlay reflects the latest reload instead of the first load.

  **cli: SARIF output reports the real CLI version.** `--format sarif` hardcoded `version: '0.1.0'`; it now reads the version from the CLI's package.json like the `--version` flag does.

  **cli: astro template accuracy.** The template is described as what it is — an Astro project rendering the `<ml-map>` web component — its `@maplibre-yaml/core` dependency is pinned to `^0.2.0` instead of `latest`, and `init` next-steps text now matches what each template actually supports.

- Updated dependencies [ab8ba89]
- Updated dependencies [8511427]
- Updated dependencies [4ed6c5e]
- Updated dependencies [1daaee2]
- Updated dependencies [291f852]
- Updated dependencies [d87a7c5]
- Updated dependencies [f716577]
  - @maplibre-yaml/core@0.3.0

## 0.1.12

### Patch Changes

- Updated dependencies [937738a]
  - @maplibre-yaml/core@0.2.0

## 0.1.0

### Patch Changes

- Updated dependencies [e7e1126]
  - @maplibre-yaml/core@0.1.0
