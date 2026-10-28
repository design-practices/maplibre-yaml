# core browser entry — bundle-diet measurements (main @ 525157b, 2026-10-28)

Units: KB = 1000 B. "gzip" = GNU `gzip -9` unless marked zlib (Node zlib level 9, ~0.4% larger:
198,596 vs 197,751 on the entry). Build: `pnpm --filter @maplibre-yaml/core build`, exit 0.
Scratch scripts: `attr.mjs` (source-map attribution of the real `dist/register.browser.js`),
`replica.mjs` (esbuild 0.27.2 replica of tsup's browserBuild, `--metafile`, optional `--strip`
of `.describe()`; replica 197,667 vs real 197,751 gzip, the banner), `census.cjs`. Raw output:
`attr.txt`, `attr.json`, `attr-combos.json`, `attr-strip.txt`, `census.txt`, `rep-*/meta.json`.

## 1. Current numbers

| Item | raw | gzip | note |
|---|---:|---:|---|
| `dist/register.browser.js` | 648,922 | **197,751** | brotli-11 166,971 (zlib) |
| budget ceiling (`size-baseline.json`) | | 198,138 | baseline 184,826 @4df43a1 + allowance 13,312 |
| headroom | | **387 B** | allowance raised 4,096 → 10,240 (2ecf8c7, U5) → 13,312 (a1bcdbf, ingest U4) |
| `dist/index.browser.js` (tooling, seam inlined) | 1,567,087 | 548,593 | not a page load |
| history | | | 0.7.0 91.0 · 0.8.1 122.6 · 0.9 readers split 157.2 (ml-7qa.5 note) · 0.9.1 ~175 · now 197.8 |

Existing lazy chunks (`dist/chunks/`, self-contained, fetched relative to the entry):

| chunk | raw | gzip | trigger |
|---|---:|---:|---|
| pmtiles | 19,424 | 7,586 | pmtiles source / `pmtiles://` |
| flatgeobuf | 44,825 | 11,956 | `.fgb` / type flatgeobuf |
| geoparquet | 68,894 | 22,673 | `.parquet` / type geoparquet |
| geoparquet-brotli | 101,411 | 68,025 | brotli-compressed parquet footer |
| cog | 371,762 | 131,922 | COG raster/raster-dem |
| cog-deflate / -jpeg / -lerc / -zstd | 23.5k / 12.4k / 127.8k / 82.5k | 8,482 / 4,746 / 47,973 / 33,225 | per COG compression |
| protomaps-basemap | 38,353 | 6,847 | `basemap:` protomaps style |
| update (0.10) | 15,733 | 5,476 | first changed document on a running map |
| toml (0.10) | 43,485 | 12,058 | first TOML document |
| convert (0.10) | 8,962 | 3,492 | `convertDocument` only; no element asks |

## 2. Status of docs/plans/2026-10-18-lazy-loading-plan.md

| Unit | Status | Evidence / why |
|---|---|---|
| format readers as `format:*` chunks (§9) | **shipped 0.9.0** | `formats/decoders.ts` LOADERS seam; tsup rewrites seam `import()` → `./chunks/<name>.js` (PRs #166/#170, 59938d8…). 0.10 reused the seam for `update`, `toml`, `convert`. |
| 1a Rollup browser build | **not shipped; replaced** | tsup/esbuild kept. CDN entry stays unsplit; chunks are separate self-contained entries. ml-7qa.5 comment: esbuild splitting put `__export` in a shared chunk every page fetched. npm build got `splitting: true` (dist/formats, dist/shared). |
| 1b story chunk | not shipped | `register.ts` statically imports + registers `ml-scrollytelling` |
| 1c messages chunk | not shipped | `ml-map.ts` imports error-card / map-notice / student-messages statically |
| 1d live chunk (ml-7qa.2) | not shipped | `layer-manager.ts` imports polling/streaming/merge/loading-manager |
| 1e interactions chunk | not shipped | `map-renderer.ts` imports event-handler / popups |
| 1f `describe()` strip | not shipped | 538 `.describe()` calls survive in the browser build |
| 1g lazy maplibre-gl | not shipped | |
| 1h SSR-safe register (ml-7qa.6) | **shipped 0.9.1** | 8536da4 |
| 0a budget (ml-7qa.1) | **partial** | only a single-entry gzip gate (`tests/bundle-size.test.ts`, from live-docs U4, ml-4ug.4); no per-chunk/scenario budgets, no graph assertions. `emitter/assets.ts` (10 B, `DEFAULT_PIN_WIDTH`) still in the entry. `lazy-chunks.test.ts` guards chunk self-containment. ml-7qa.1 open. |
| 0b preload snippet (ml-7qa.7) | not shipped | no `modulepreload` in docs/templates |
| 2a parse chunk | not shipped; **enabler exists** | 0.10 `parseDocumentText` is async; `readDocumentTextNow` returns `undefined` when a reader chunk is needed (TOML). The elements use the sync path so YAML/JSON still render "in the same turn". |
| 2b object `config` without yaml | not shipped | `safeParseMapBlockValue` still `stringifyYAML(value)` → re-parse (TOML values too) |
| 2c Astro prevalidated config | not shipped | no prevalidation path in astro or `ml-map` |
| 3a–3c extras / story schemas / zod4-mini | not shipped | Phase 3 was "if budgets demand" |

Why the rest stalled: the plan's Outcome note says the maintainer moved everything past 0.9; the
mechanism the plan depended on (Rollup, chunks importing back from the entry) was never built, and
the shipped seam only admits chunks that import **no core code** (or receive it injected, as
`update` does via `UpdateHost`). That rule is the main constraint for every lever below.

## 3. Composition of register.browser.js (source-map attribution, zlib)

`own` = the group's bytes gzipped alone (≈ its cost as a separate chunk). `marginal` = gzip(all) −
gzip(all without the group) = what a page saves if the group leaves the entry. Neither column sums
exactly to the total (Σown 206.4 KB, Σmarginal 198.7 KB, total 198.6 KB zlib).

| Group | raw | gzip own | gzip marginal | share | 0.8.1 marginal |
|---|---:|---:|---:|---:|---:|
| yaml (npm) | 97.5 | 30.2 | **30.3** | 15.2% | 30.2 |
| renderer core (map-renderer 10.1, layer-manager 6.0, cloud-protocols/sources 4.9, interop/attribution 2.1, basemap 1.1, update/order+rebuild 0.6) | 79.1 | 25.8 | **24.8** | 12.5% | 9.0 |
| parser (yaml-parser 6.2, diagnostics 4.5, validation-utils 3.3, normalize/source-refs 3.2, format/cog checks 2.9, spec-keys 1.3, expand-sugar 0.8) | 67.8 | 22.8 | **22.5** | 11.3% | 13.7 |
| schemas (map+v2 4.6, layer 3.6, source 2.8, story/page/content 2.3, base/geojson 2.3, css-colors 1.2) | 66.2 | 17.6 | **17.5** | 8.8% | 13.5 |
| classify (code 7.4, palettes-data 4.6, schema 2.7, runtime 1.4) | 49.6 | 16.2 | **16.1** | 8.1% | — (new) |
| story (element 6.2, engine/render/keys/legend 5.2, CSS string 4.1) | 50.0 | 15.9 | **15.3** | 7.7% | 12.9 |
| zod (npm) | 60.0 | 14.2 | **14.1** | 7.1% | 13.9 |
| formats in entry (geoparquet/flatgeobuf/pmtiles adapters 7.4, cog-* 2.2, detect/large-data 1.7, protomaps-style 1.2) | 35.3 | 12.8 | **12.5** | 6.3% | — (new) |
| components (`ml-map` 8.7, base/styles 0.3) | 30.5 | 9.5 | 9.0 | 4.5% | 4.9 |
| messages (student-messages 7.0, i18n 1.9) | 23.6 | 9.2 | 8.8 | 4.4% | ~3.2 |
| renderer optional (images 1.5, chrome/controls 1.2, legend 1.1, params 1.0, markers 0.5, scene-3d 0.4) | 18.8 | 6.6 | 5.8 | 2.9% | 4.2 |
| live data (polling/retry/SSE/WS/merge 3.3, loading UI 0.9) | 16.5 | 4.6 | 4.2 | 2.1% | 4.0 |
| interactions (+event-handler, popups, highlight-paint) | 12.2 | 4.4 | 4.0 | 2.0% | 3.4 |
| front door 0.10 (document-text 2.4, document-ingest+script 0.7) | 8.2 | 3.6 | 3.2 | 1.6% | — (new) |
| utils | 9.0 | 3.7 | 3.1 | 1.6% | ~1.9 |
| error UI (error-card 1.2, map-notice 1.2, author-hints 0.2) | 7.7 | 3.2 | 2.7 | 1.3% | ~2.0 |
| model (+ emitter/assets 10 B) | 8.3 | 2.7 | 2.4 | 1.2% | 2.4 |
| data (fetcher, cache, source-data, property-names) | 6.8 | 2.6 | 2.0 | 1.0% | 1.8 |
| register/capabilities, effects host, unmapped | 1.8 | 0.7 | 0.6 | 0.3% | 0.5 |

Growth since 0.8.1 (+75 KB): classify +16, cloud adapters/protocols in the entry +17.6, parser +8.8
(format/cog checks, normalize, source-refs), renderer core +7 excluding cloud, `ml-map` +3.8,
schemas +4, messages/i18n +5.6, story +2.4, front door +3.2. The plan's "format modules stay in the
entry, are small" (decoders.ts doc comment) no longer holds: they are 17.6 KB.

## 4. Feature census (method of the 0.8.1 spike's `feature-census.js`, extended)

483 documents after content-hash dedupe (5 dups): A = `docs/public/configs/**` + classics (138),
B = fenced YAML in docs mdx (76), C = `examples/**` YAML + inline `<script type=text/yaml>` + CLI
templates (127), D = `examples/verification` fixtures (142; test pages, skew to cloud/story/legend).
3 unparsable files used the regex fallback; 3 non-map YAML files skipped. No JSON/TOML documents in
the corpus. `params` counts parameters/state or a toggleable layer `label` (what builds the panel).

| feature | A | B | C | D | all (483) | real docs A+B+C (341) |
|---|---:|---:|---:|---:|---:|---:|
| scrollytelling | 2 | 14 | 6 | 20 | 8.7% | 22 = 6.5% |
| interactions / popups | 25 | 8 | 21 | 15 | 14.3% | 54 = 15.8% |
| legend block | 7 | 4 | 7 | 22 | 8.3% | 18 = 5.3% |
| params / state panel | 12 | 7 | 12 | 13 | 9.1% | 31 = 9.1% |
| markers | 5 | 1 | 5 | 4 | 3.1% | 11 = 3.2% |
| live data | 5 | 3 | 2 | 2 | 2.5% | 10 = 2.9% |
| classify | 6 | 2 | 2 | 11 | 4.3% | 10 = 2.9% |
| terrain/sky/projection | 9 | 2 | 10 | 1 | 4.6% | 21 = 6.2% |
| effects | 2 | 2 | 0 | 3 | 1.4% | 4 = 1.2% |
| images | 9 | 2 | 9 | 5 | 5.2% | 20 = 5.9% |
| cloud formats (pmtiles/fgb/parquet/cog) | 7 | 9 | 5 | 51 | 14.9% | 21 = 6.2% |
| **plain** (none of the above) | 74 | 32 | 66 | 45 | 44.9% | **172 = 50.4%** |

Top combinations (all 483): plain 217, cloud-only 49, interactions-only 39, 3D-only 25, story-only
25, images 11, params 11, legend 10, story+legend 8, markers 8, live 7.

## 5. Levers, priced on a plain map page (one GeoJSON layer, no popups, no story)

Savings are zlib marginals from §3 (combos in `attr-combos.json`); "pages helped" = real docs not
using the feature. Seam rule: a CDN chunk is a self-contained entry — any core module it imports
is **duplicated** into it (bytes + a second module instance), so a chunk that needs core code must
take it injected (the `UpdateHost` pattern) or the build must learn "chunk imports back from the
entry" (what Rollup gave the plan).

| Lever | Plain-page saving | Pages helped | Critical path? | Trigger on the parsed document | Risk |
|---|---:|---:|---|---|---|
| **Strip `.describe()`** (browser build only; 538 calls; nothing reads `.description` at runtime) | **−8.7 KB** (measured, replica, every page) | 100% | yes (it's in the parse stage) | none: build-time | Low. npm build keeps them (JSON-Schema emit, map-party). Guard: corpus-equivalence test on the stripped schemas. No chunk, no CDN change. |
| **Cloud adapters + protocols** (`formats/*` + `renderer/cloud-*`) behind the seam | **−17.6 KB** | ~94% | yes for cloud docs (protocols before `new Map()`) | `formatsIn()` / `formatOfSource()` already exist in `formats/detect.ts` (keep detect + a thin `pmtiles://` handler in the entry) | Medium. Adapters import core (student-messages `describeFormatFailure`, errors, `columns`→classify): needs host injection. Cloud pages gain one hop before the library chunk unless adapter+library are one chunk. |
| **Story chunk** (element + engine + CSS, ± story/page/content schemas) | **−15.3 KB** (−17.6 with schemas) | ~93% | no for maps; yes for stories | `<ml-scrollytelling>` in the DOM (on sight + MutationObserver), not the document | High mechanism cost: the element imports ml-map, parser, document-ingest, error-card… → duplicated unless injected/import-back. `/register` exports `MLScrollytelling` sync; `registerMLScrollytelling()` would become async (Astro `Scrollytelling.astro`, map-party). Story pages +1 RTT (plan measured +1.1 s Fast 3G without lazy maplibre/preload). Story CSS minify alone (lightningcss in tree): **−1.3 KB** now, low risk. |
| **Classify chunk** (palettes-data + breaks/compile/checks + schema + runtime) | **−16.1 KB** (palettes-data alone −4.6, not ~2.7 as ml-7qa.11 says) | ~97% | yes for classify docs | any layer `classify:` — scan the yaml value before zod; `readDocumentTextNow` returns `undefined` (the TOML pattern) and `parseDocumentText` awaits `getDecoder("classify")` | Medium-high: wide fan-in (schema `superRefine` palette lookup, parser checks, `to-model` lower, legend, popup `numericValue`, highlight-paint, columns, story-legend). Classify docs lose same-turn render. Palette-data-only split is smaller work but needs the same async hook. |
| **Messages + error UI** (catalogue, error-card, map-notice, author-hints) | **−9.7 KB** (−11.5 incl. i18n, but i18n is used by legend/popups/params) | pages without a problem | no (error path) | first parse/validation error, fetch failure, runtime notice, or a parser *warning* shown on page | Medium: a chunk download on the first error — which may itself be the failure (offline, half-copied `dist/`): needs a plain-text fallback card. `ml-map:error` must stay sync; ~10 tests assert sync cards. `describeFormatFailure` is used by formats/errors. |
| Live data (polling/SSE/WS/merge/retry + loading UI) — ml-7qa.2 | −4.2 KB | ~97% | no (after first data load) | source/layer `refresh`, `refreshInterval`, `stream`, `updateStrategy`, `loading` | Low-medium: `LayerManager` constructs managers lazily; live sources show data one hop later. |
| Interactions / popups | −4.0 KB | ~84% | no (attach at `load`) | layer `interactive` / `runtime.interactive`, marker `popup`, `popups:` | Low-medium; hover popups miss the first ms after load; the CLI `basic` starter has a popup, so `init` output pays it. |
| Extras (legend 1.1, params 1.0, images 1.5, markers 0.5, scene-3d 0.4) | −4.6 KB together; each ≤1.5 | 91–97% each | images/3D: before style/map load | `legend`, `parameters`/`state`/toggleable `label`, `images`, `markers`, `terrain`/`sky`/`projection` | Poor ratio: five async seams for <1 KB each. Only as one `extras` chunk. |
| Front door 0.10 (document-text 2.4 + ingest 0.7) | ≤ −1.5 KB (JSON wording, TOML label hints → error path / toml chunk) | JSON/TOML-free pages | yes: every text doc goes through it | — | Low value; core routing must stay. |
| yaml library (30.3) | −30.3 only for object-`config` / JSON pages (0 in corpus) and only if yaml leaves the entry | ~0% on CDN | yes for every YAML text doc | object config → validate the value directly (2b); JSON could `JSON.parse` + a JSON position scanner | YAML pages (all CDN docs) still pay it plus a hop. Positions on every error depend on yaml's CST; js-yaml swap rejected (CST, `!html`, alias guard). Value lands in bundlers/Astro, not the CDN entry. |
| zod + schemas lighter path | zod 4 mini −5.7 (plan measure); light validator rejected | 100% | yes | — | 57 `.default()`s the renderer consumes; warnings run on success; zod 4 is a breaking public-type change → 1.0 window. |
| Whole parse stage as a chunk (2a) | ~0 on CDN (90 KB own; fetched in parallel with `src`) | — | yes | any text doc | Enables 2b/2c; prevalidated Astro page would drop **−81.5 KB** (stripped build). Same-turn render guarantee and ~180 test migrations (proto-c). |

Combined: every optional plain-page lever (story, messages/error UI, interactions, extras, live,
classify, cloud) = **−73.3 KB** marginal; with the `describe()` strip, the plain-page entry would be
~118.7 KB zlib (~118 KB gzip, −40%), of which the parse stage is 81.5 KB and the render core ~37 KB.

## 6. Cross-cutting risks for any new chunk

- **CDN resolution:** chunks resolve relative to `register.browser.js` (unpkg/jsDelivr/copied
  `dist/`). The `register.js` root shim, renamed or single-file self-hosted copies, and jsDelivr
  range skew (no VERSION handshake, ml-7qa.8) bite once chunks hold our own code.
- **Import maps:** only `maplibre-gl` is mapped; chunks must not import it (inject it).
- **Bundlers / Astro dev:** npm build already splits (`dist/formats`, `dist/shared`); Vite's
  optimize-deps pre-bundles core and turns `import()` into its own chunks — verified for
  pmtiles/flatgeobuf (ml-7qa.10: webpack untested; ml-7qa.9: esm.sh unverified).
- **Waterfall:** every chunk on a critical path waits for the entry; without lazy maplibre-gl (1g)
  or preload hints (ml-7qa.7) a hop costs ~0.5–0.6 s on Fast 3G.
- **Budget:** 387 B headroom today — any further 0.10.x addition to the entry fails
  `bundle-size.test.ts`; the `describe()` strip alone would buy ~8.7 KB.
