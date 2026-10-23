---
title: Lazy-loading across the board for 0.9 — measured plan
type: plan
date: 2026-10-18
topic: lazy-loading
beads: ml-7qa.5 (epic ml-7qa; also ml-7qa.1, ml-7qa.2, ml-7qa.6, ml-7qa.7, ml-aot.57, ml-cnv)
status: partly implemented in 0.9.0 (format readers); the rest is open — see Outcome below
---

# Lazy-loading across the board for 0.9 — measured plan

> **Outcome (2026-10-23).** 0.9.0 shipped only the first slice: the format
> readers (PMTiles, FlatGeobuf, GeoParquet with its brotli codec, COG with its
> image codecs, and the Protomaps basemap generator) load on demand from
> `dist/chunks/` in the CDN build and from split chunks in the npm build
> (PRs #166 and #170). A failed chunk shows a notice on that source and is
> retried on `reload()`. `register.browser.js` is about 175 KB gzip in 0.9.1
> (124 KB in 0.8.1); everything else in this plan is still open and moved past
> 0.9 by the maintainer: the story engine, the error catalogue, the live-data
> machinery (ml-7qa.2), the parser, lazy maplibre-gl, the size budget in CI
> (ml-7qa.1), and a per-chunk version check (ml-7qa.8). The SSR import fix
> (ml-7qa.6) shipped separately in 0.9.1. Treat the measurements below as the
> 0.8.1 baseline.

> **Status.** A design proposal, not an implementation. All prototypes and
> measurements live outside the repo (`~/dev/lazy-loading-spike/`, see
> [Appendix A](#appendix-a--reproducing-the-numbers)). Nothing here changes
> published code. Units: **kB = 1000 bytes**, gzip level 9 / brotli quality 11
> via Node `zlib`, minified ESM, maplibre-gl external. "Today" is PR #156's head
> (`origin/fix/0.8.1-classroom`), the 0.8.1 baseline.

## TL;DR

- **Today, every page pays for everything.** `register.browser.js` (0.8.1) is
  **122.6 kB gzip / 105.4 kB brotli**, one file. A Vite app importing
  `@maplibre-yaml/core/register` ships **123.5 kB**. Since 0.7.0 (91.0 kB) it
  has grown 35%.
- **Most pages need very little of it.** In a census of 321 documents (gallery,
  docs, starters), **56% use no optional feature at all**. Interactions/popups
  are in 13%, stories 9%, live data 6%, legend 4%.
- **58% of the bundle (71 kB gzip) is the parse-and-validate stage**: `yaml`
  (30.2), `zod` (13.9), the schemas (13.4), the parser and diagnostics (13.8).
  It is reachable only from the parser, never from the renderer, so it splits
  cleanly.
- **Bytes are not the main latency cost; the module waterfall is.** On Fast 3G
  a plain map today reaches `ml-map:load` in **7.47 s**. Shipping 19 kB less
  alone saves 0.07–0.14 s. Removing the waterfall (lazy `maplibre-gl`, flat
  chunk graph, preload hints) saves **0.8–2.5 s**. The plan does both.
- **Recommended mechanism:** build the browser ESM with **Rollup** (not
  esbuild/tsup `splitting`; measured as one extra round trip, +0.5 s on Fast
  3G). Split on demand by **feature detection on the parsed document**. Load
  **`maplibre-gl` itself on demand**, starting it when the element registers.
  The npm build gets `splitting: true`, so Vite, Astro, webpack and React
  consumers get the same `import()` boundaries for free.

| Page (CDN, gzip) | Today | Phase 1 (0.9.0) | Phase 2 (0.9.x) |
|---|---:|---:|---:|
| Plain map | 122.6 kB, 1 file | **~90 kB** (−27%) | ~92 kB in 3 files (CDN); **~26 kB** where config is prevalidated (Astro) |
| Map + popups | 122.6 | **~94** | ~96 / ~30 |
| Story page | 122.6 | **~106** | ~108 |
| Page with an error | 122.6 | ~96 | ~99 / ~33 |
| Plain map, `ml-map:load` on Fast 3G | 7.47 s | ~6.9 s (estimate) | **6.61 s** measured (prototype); **4.99 s** with the preload snippet |
| Story page, `ml-map:load` on Fast 3G | 7.45 s | ~7.0 s (estimate) | **6.77 s** measured; **5.12 s** with the snippet |

Phase 1 numbers combine measurements (story, messages, `describe()` stripping)
with attribution estimates (live data, interactions). Phase 1 latency is
estimated from the prototype: lazy `maplibre-gl` without the parse split
leaves about 57 kB more in front of maplibre-gl's fetch, roughly +0.35 s on
Fast 3G. Phase 2 CDN pages ship about the same bytes as Phase 1 but in
parallel, which is faster. Phase 2's big win is for bundled pages whose config
was already validated on the server.

The **preload snippet alone** brings today's 0.8.1 from 7.47 s to 5.22 s. It
is a docs change that can ship before 0.9 (Q8).

---

## 1. Measurements

### 1.1 Where the bytes go (0.8.1 `register.browser.js`)

Method: esbuild with tsup's browser options, plus a metafile and source map.
Each minified byte is attributed to its source file through the source map.
**Marginal** is gzip(all) − gzip(all without the area): what a page pays for
the area inside today's monolith. **Own chunk** is the area gzipped alone: its
cost as a separate file. My esbuild replica is 418.3 kB raw against tsup's
420.0 kB; the difference is banners.

Usage is the share of the 321-document census that needs the area. Corpora: A
is the 105 gallery configs, B is 154 docs configs and mdx snippets, C is 62
starters, templates and examples. "All" is all 321. "No YAML key" means the
area is needed on every page.

| Feature area | raw min | gzip marginal | brotli marginal | gzip own chunk | Pages that need it (A / B / C / all) |
|---|---:|---:|---:|---:|---|
| **Parse stage** (total) | 249 | **71.3** | 58.6 | — | every text document (src / inline YAML); not prevalidated configs |
| ↳ `yaml` (npm) | 97.7 | 30.2 | 26.5 | 30.4 | ″ |
| ↳ `zod` runtime (npm) | 59.7 | 13.9 | 11.9 | 14.2 | ″ |
| ↳ map/layer/source/base/geojson/v2 schemas | 44.5 | 10.2 | 8.1 | 10.7 | ″ |
| ↳ parser (yaml-parser, expand-sugar, spec-keys, validation-utils) | 31.5 | 9.7 | 8.0 | 10.4 | ″ |
| ↳ diagnostics (document-checks, yaml-errors, suggest) | 11.2 | 4.1 | 3.3 | 4.7 | ″ (some run on success too) |
| ↳ story/page/content schemas | 8.3 | 2.1 | 1.6 | 2.7 | ″ (only needed for story/page docs) |
| ↳ css-colors | 2.6 | 1.1 | 0.9 | 1.2 | ″ |
| **Story engine**: `<ml-scrollytelling>`, engine, render, keys | 27.9 | **9.1** | 7.2 | 9.8 | 1% / 13% / 13% / **9%** |
| Story CSS string (`scrollytelling/styles`) | 12.1 | 3.7 | 2.6 | 3.3 | ″ |
| `<ml-map>` element + styles | 17.6 | 4.9 | 3.5 | 5.7 | 100% (no YAML key) |
| renderer: map-renderer | 14.1 | 4.5 | 3.8 | 5.3 | 100% |
| **Error cards + message catalogue** (error-card, student-messages) | 11.2 | **4.2** | 3.3 | 4.7 | only on a problem (no YAML key) |
| On-page notice (map-notice) | 3.0 | 1.0 | 0.8 | 1.4 | only on a problem or warning |
| **Interactions/popups** (interactions/\*, event-handler, popup-builder, popups-manager) | 10.7 | **3.4** | 2.8 | 3.9 | 9% / 12% / 24% / **13%** |
| **Live data** (polling, SSE, WebSocket, merge, retry) | 12.8 | **3.2** | 2.6 | 3.6 | 2% / 9% / 5% / **6%** |
| Loading UI (loading-manager, ui/styles) | 3.3 | 0.8 | 0.7 | 1.1 | <1% configure it; created with the live machinery |
| renderer: layer-manager | 10.4 | 2.8 | 2.1 | 3.3 | 100% |
| model (normalize, sugar, read-v2, to-model) | 7.9 | 2.4 | 1.9 | 2.6 | 100% |
| data-fetcher + memory-cache | 6.0 | 1.8 | 1.5 | 2.3 | 25% (`url:` GeoJSON) |
| interop + attribution guard + attribution | 4.2 | 1.8 | 1.5 | 2.1 | 100% |
| base resolver (document-base, config-resolver) | 3.2 | 1.1 | 1.0 | 1.3 | 100% (16% use relative URLs or a basemap) |
| chrome layout + controls-manager | 3.8 | 1.1 | 0.8 | 1.4 | 13% (controls); layout needed for legend/params/slots |
| Params panel (params-builder) | 3.5 | 0.9 | 0.8 | 1.3 | 6% / 3% / 10% / **5%** |
| Images loader (images-loader, image-refs) | 2.7 | 0.9 | 0.7 | 1.3 | 7% / 3% / 7% / **5%** |
| Legend (legend-builder) | 1.7 | 0.5 | 0.5 | 0.9 | 0% / 6% / 7% / **4%** |
| Markers (markers-manager) | 1.5 | 0.4 | 0.4 | 0.7 | 4% / 2% / 5% / **3%** |
| 3D setters (scene-3d: terrain/sky/projection) | 1.6 | 0.4 | 0.4 | 0.6 | 8% / 1% / 0% / **3%** |
| Effects host | 0.3 | 0.1 | 0.2 | 0.2 | 3%; the effects package is already separate |
| utils (html, tile-url, event-emitter, swapped-center) | 2.0 | 0.7 | 0.5 | 1.1 | 100% |
| capabilities + extensions | 0.4 | 0.2 | 0.3 | 0.3 | 100% |
| **Export/emit** (`emitter/*`, `export/*`) | 0.01 | 0.0 | 0.0 | — | **absent, verified** (see 1.3) |
| **Total** | 418.3 | **122.6** | 105.4 | | |

**Plain map**: none of interactions, legend, params, markers, images, live,
3D, story or effects. Counts: **181/321 (56%)**. Per corpus: gallery 62%,
docs 55%, starters 50%.

**Most common combinations:** plain 181, interactions only 31, story only 25,
3D only 18, live only 7, interactions+live 7. The CLI `basic` starter has a
popup, so **"map + popups" is what `init` produces**.

The gallery's 139 upstream rows rate 78 YAML / 51 YAML+JS / 4 plugin / 6 JS /
0 gaps. Many YAML+JS rows add behaviour in page JS, so corpus A's "plain" is an
upper bound.

### 1.2 History and the bundler path

| Build | raw | gzip | brotli |
|---|---:|---:|---:|
| 0.7.0 `register.browser.js` | 324.8 | 91.0 | 79.2 |
| 0.8.0 | 382.7 | 109.8 | 94.9 |
| 0.8.1 (PR #156 head, tsup) | 420.0 | **122.6** | **105.4** |
| 0.8.1 npm `dist/register.js`, as a **Vite 6 app** bundles it (rollup + esbuild minify) | 420.5 | **123.5** | 106.1 |
| Same, Rollup library build instead of esbuild (no other change) | 410.9 | 120.5 | 103.7 |

The ml-7qa.5 bead quotes 117.7 kB for 0.8.1. That was an earlier snapshot of
#156 (118.0 kB in these units); the branch grew about 4.6 kB since.

### 1.3 Export/emit in the browser build: absent (verified)

The metafile's input graph for `register.browser` contains no `emitter/*` or
`export/*` module except `emitter/assets.ts`. That file contributes **10
bytes**: the `DEFAULT_PIN_WIDTH` constant that markers-manager imports.
**Recommendation:** move the constant to a shared constants module so the
graph has no emitter edge at all, and assert that in the CI budget (§5).
`index.browser.js` (the full API for tooling pages) still includes emit, by
design.

### 1.4 Latency today: where the time goes

Setup: Fast 3G (DevTools preset: 562.5 ms RTT, 1.44 Mbps down), cache
disabled, hermetic local "unpkg" (gzip, same URL layout), maplibre-gl 6.12.0,
a background-only style and a 40-point GeoJSON. The metric is time to
`ml-map:load`. Plain-map waterfall today:

```
   0 →  577  page.html
 599 → 1183  @maplibre-yaml/core@0.8.1/register.js        (root shim: one extra round trip)
1186 → 2503  dist/register.browser.js        122.8 kB
2516 → 4020  maplibre-gl.mjs                 152.4 kB     (starts only after our bundle arrives)
4036 → 5521  maplibre-gl-shared.mjs          148.4 kB     (maplibre's own serial hop)
5591 → 6161  data/plain.yaml                              (fetched only after ALL modules evaluate)
6230 …       worker, style.json, points.geojson           → ml-map:load at 7467 ms
```

The page is a **chain of seven serial round trips**. Our 123 kB is only one
link. Every lazy chunk we add costs another round trip *after maplibre-gl*,
unless the design flattens the chain. That changed the plan (§2.4).

---

## 2. Mechanism

### 2.1 Split points and triggers

Each chunk is triggered by something the element can see. Detection runs on
the **parsed, normalized document** (`MapModel`), or on the DOM for the story
element. Fetches start the moment detection runs. The renderer awaits each
chunk only at the latest point it is needed.

| Chunk | Contents | Trigger (detection) | Awaited at | gzip (own) |
|---|---|---|---|---:|
| *entry* `register.browser.js` | `<ml-map>`, renderer core, layer manager, model, data-fetcher, base resolver, chrome/controls, small features (Phase 1) | — | — | Phase 1 ~90; Phase 2 ~26–33 |
| `story` | `<ml-scrollytelling>`, engine, render, keys, **minified** CSS, story/page schemas (Phase 3) | `<ml-scrollytelling>` in the document (on sight + MutationObserver), or an explicit `@maplibre-yaml/core/story` import | element definition | 13.2 (+3.5 shared) |
| `messages` | error card, message catalogue (student-messages), on-page notice, css-colors suggestions | the first problem: a parse/validation error, fetch failure, runtime layer/source/data/image/marker problem, or a parser warning shown on the page | card/notice render (`ml-map:error` still dispatched synchronously where it is today, see 2.7) | 6.3 |
| `interactions` | interactions/\*, event-handler, popup-builder, popups-manager | any layer `interactive` (v1) / `runtime.interactive` (v2), a marker `popup`, top-level `popups:` | `map.on("load")` (never delays first paint) | ~3.9 |
| `live` (= ml-7qa.2) | polling, SSE, WebSocket, merge, retry, loading UI | any source/layer `refresh`, `refreshInterval`, `stream`, `updateStrategy`, `loading` | after the first data load | ~4.4 |
| `parse` (Phase 2) | `yaml`, `zod`, schemas, parser, diagnostics | any text document (`src`, inline `<script type="text/yaml">`) or an unvalidated `config` | before render (fetched **in parallel** with the `src` fetch) | ~67 (two files today, see 4.1) |
| `maplibre-gl` (peer) | the import-map / bundler-resolved maplibre-gl | any `<ml-map>`/`<ml-scrollytelling>` on the page, at register time | `new Map()` | 301 (not ours) |
| `extras` (Phase 3, optional) | legend, params panel, markers, images loader, scene-3d setters | `legend` block, `parameters`/`state`/layer `label`, `markers`, `images`, `terrain`/`sky`/`projection` | style load (3D) / map load | ~3.1 |
| format decoders (ml-cnv) | pmtiles, COG, FlatGeobuf, GeoParquet adapters | source URL scheme / type / extension (see §9) | **before** `new Map()` (protocols) or before source creation | per decoder |

**Why not split the small features (Phase 3)?** Legend, params, markers,
images and 3D together are 3.1 kB marginal. Each is under 1 kB gzip, where
compression is poor and the renderer change is real (map-renderer constructs
them inline). Splitting them pays only if the budget demands it. The census
says each appears in 3–5% of pages.

**Not split, on purpose:** the data-fetcher (1.8 kB, a quarter of pages fetch
`url:` GeoJSON, and it is on the critical path), the base resolver (every
`src`/relative URL), chrome layout/controls (13%, and slots use it), the
attribution guard (every map).

### 2.2 Build: Rollup for the browser build, tsup splitting for npm

Three builds of the same split prototype were compared:

| Variant (story + messages split) | plain-page JS | requests | Fast 3G `ml-map:load` (plain / story / error) |
|---|---:|---:|---|
| 0.8.1 monolith (tsup) | 122.6 kB | 1 (+shim) | 7.47 / 7.45 / 6.20 s |
| **esbuild `splitting: true`** (what tsup does) | 108.2 kB | **3** (+shim) | **7.93** / 9.18 / 7.82 s |
| **Rollup** (Vite 6 library mode) | **103.7 kB** | **1** (+shim) | 7.33 / 8.59 / 7.20 s |

esbuild's splitter moves code shared between the entry and *any* dynamic
chunk out of the entry into shared chunks. The entry becomes a 0.6 kB stub
that imports two ~53 kB chunks: one extra round trip on every page, +0.5 s on
Fast 3G. Rollup leaves code that the entry already loads in the entry; lazy
chunks import back from it. It also tree-shakes slightly better (120.5 vs
122.6 kB unsplit).

**Recommendation:**

- **Browser build (`register.browser`):** a Rollup build. Vite library mode is
  already a dev dependency through the docs site. It uses
  `preserveEntrySignatures: "allow-extension"` (no facade entry) and a
  whitespace-minify pass (Vite keeps whitespace in ES lib output). Chunk names
  are stable, with no content hash: `dist/chunks/story.js`, `messages.js`,
  `interactions.js`, `live.js`, `parse.js`. The version is already in every
  CDN path, so hashes add nothing there. Stable names let authors and
  templates write `modulepreload` hints. A version handshake catches mixed
  versions (2.4).
- **`index.browser`** stays a separate **unsplit** build (tooling pages want
  one file). It must not share a chunk graph with `register.browser`; two
  entries in one split build would create cross-entry shared chunks.
- **npm build:** tsup keeps esbuild, with **`splitting: true`**. This is
  required, not optional. With `splitting: false`, esbuild *inlines*
  dynamically imported local modules and the boundary is lost. Consumers'
  bundlers re-chunk anyway, so esbuild's stub-entry layout does not matter
  there. Measured: a Vite 6 app on the split npm build gets a 106.9 kB main
  chunk (vs 123.5 today), plus `story`/`messages` chunks loaded on demand.
  Vite's `__vitePreload` fetches a dynamic chunk's dependencies in parallel.
- **Flat lazy graph.** Rollup emitted `story → student-messages` and
  `yaml-parser → validation-utils` as *static chunk-to-chunk* imports. Each
  one is a serial round trip after the parent arrives (+0.6 s each on Fast
  3G, visible in the story and error waterfalls). The browser build adds a
  small Rollup plugin (`renderDynamicImport` + `generateBundle`, the pattern
  Vite's own preload helper uses) that rewrites `import("./chunks/story.js")`
  into "start every static dependency of `story` in parallel, then import it".
  Chunk boundaries are chosen so that no chunk statically imports another lazy
  chunk where avoidable. Concretely: the catalogue must not pull schema
  modules, so css-colors and spec-keys move to a data-only module.

### 2.3 The loader (internal API)

One internal module, `src/lazy/features.ts`, owns every on-demand load:

```ts
type Stage = "define" | "before-map" | "style-load" | "map-load" | "data";

interface LazyFeature<M> {
  name: "story" | "messages" | "interactions" | "live" | "parse" | "extras" | `format:${string}`;
  /** Static detection on the parsed document (or DOM for "story"). Pure, cheap. */
  detect(model: MapModel): boolean;
  load(): Promise<M>;            // import("./chunks/<name>.js") — literal path, bundler-visible
  stage: Stage;                  // the latest point the renderer awaits it
  required: boolean;             // failure blocks rendering (story, parse, decoders) or degrades (interactions, live, extras)
}

/** Memoized: one fetch per page, however many maps. */
export function loadFeature<M>(f: LazyFeature<M>): Promise<M>;
/** After parse: kick off every detected feature in parallel with maplibre-gl + style. */
export function prefetchFeatures(model: MapModel): Map<string, Promise<unknown>>;
```

- **Literal `import()` paths only.** Bundlers can see them, and the npm build
  keeps them as real boundaries. Computed specifiers are banned in the loader
  (lint rule).
- **Generation tokens.** Every async continuation checks it still belongs to
  the current render: `if (gen !== this.renderGeneration) return`. A card that
  resolves after a newer config rendered is dropped. The prototype did not do
  this, and a real implementation must.
- **Failure handling** was tested by deleting a chunk:
  - **Required features** (story, parse, decoders) render a **plain-text
    card**. It is built by eager code with no catalogue:
    `maplibre-yaml could not load part of itself (<chunk URL>): <error>`. If the
    URL contains a version range, it adds `pin an exact version (e.g. @0.9.0)`.
    It also dispatches `ml-map:error` with the same text and logs to the
    console.
  - **Enhancement features** (interactions, live, extras) leave the map
    rendered and log once.
  - The prototype's catalogue fallback worked. The deleted story chunk gave a
    blank page and an unhandled rejection. That is the case the fallback card
    exists for.
- **Version handshake:** every chunk exports `VERSION`. The loader compares
  it to the entry's, and on mismatch shows the plain-text card ("mixed
  maplibre-yaml versions …"). On the CDN it costs one string per chunk.

### 2.4 First-render latency: what the element does, in order

1. **Register** (module evaluation). Define `<ml-map>`. If any `ml-map` or
   `ml-scrollytelling` is in the document, call `loadMaplibre()` (dynamic
   `import("maplibre-gl")`). If an `<ml-scrollytelling>` is present, start
   `story`.
2. **Connect.** Start the `src` fetch **and** the `parse` chunk (Phase 2) in
   parallel.
3. **Parse** → `prefetchFeatures(model)` starts interactions, live, extras and
   decoders in parallel with the style fetch.
4. Await `maplibre-gl` (+ `before-map` features) → `new Map()`. Await the
   other stages as the renderer reaches them.

`maplibre-gl` on demand is the lever that makes lazy chunks free. While
maplibre-gl is a *static* import of our entry, no `import()` can start until
maplibre-gl has fully downloaded, because module evaluation waits for the
static graph. Every lazy chunk then sits behind about 300 kB. Measured on Fast
3G:

| Page | 0.8.1 | Split only (Rollup) | **Split + parse lazy + maplibre-gl lazy** ("proto-c") | 0.8.1 + preload snippet | **proto-c + preload snippet** |
|---|---:|---:|---:|---:|---:|
| Plain map | 7.47 s | 7.33 | **6.61** | 5.22 | **4.99** |
| Map + popups | 7.38 | 7.31 | **6.60** | — | — |
| Story | 7.45 | 8.59 ⚠ | **6.77** | 5.26 | **5.12** |
| Error card shown | 6.20 | 7.20 ⚠ | **5.19** | — | — |

Slow 4G (150 ms RTT, 1.6 Mbps) gave the same picture: plain 3.64 → 3.52 s with
the split, story 3.68 → 3.94 s ⚠. ⚠ marks regressions caused by lazy chunks
behind a static maplibre-gl import. Proto-c fixes them. For an error page,
maplibre-gl does not block the card at all; the card shows before maplibre
finishes downloading.

Implementation notes for lazy `maplibre-gl`:

- `renderer/maplibre-interop.ts` is already the *only* value importer of
  `maplibre-gl` (built-ins import types only). It becomes `loadMaplibre()`
  plus `export let` live bindings (`Map`, `Popup`, `Marker`, controls…)
  assigned on load. Proto-c did exactly this; it typechecked and rendered all
  four pages.
- `@maplibre-yaml/core/maplibre` (`addProtocol`, `maplibregl`) gets
  `await loadMaplibre()` semantics: its exports become functions/promises or
  stay sync after an explicit `await ready()`. **This is a public API change**
  (open question Q3).
- Hosts that import maplibre-gl themselves first (Astro's worker-URL setup)
  are unaffected: both resolve to the same module instance.

**Preload snippet (docs, CLI templates, Astro).** Today's 0.8.1 with
`<link rel="modulepreload">` for our entry and maplibre-gl's two modules, plus
`<link rel="preload" as="fetch">` for the YAML, reaches load at 5.22 s instead
of 7.47 s. That is −2.2 s with **no library change**. It can ship in 0.8.x
docs immediately. With stable chunk names, the 0.9 snippet adds `chunks/parse.js`
(and `chunks/story.js` on story pages). Pointing `<script src>` at
`dist/register.browser.js` instead of the root `register.js` shim removes one
more round trip; the shim stays for unpkg's bare `/register` URL.

### 2.5 CDN path

- **unpkg** (documented: `https://unpkg.com/@maplibre-yaml/core@0.8/register.js`).
  A range URL **302-redirects to the exact version** (verified:
  `location: /@maplibre-yaml/core@0.8.0/register.js`, redirect `max-age=60`).
  A module's base URL is its *response* URL, so `./chunks/story.js` resolves
  inside `@0.8.0/dist/`, the same version. Files under an exact version are
  `max-age=31536000`.
- **jsDelivr** serves ranges **without a redirect** (verified:
  `@0.8/register.js` → 200, `x-jsd-version: 0.8.0`, `max-age=604800`). A
  cached entry from 0.9.0 can sit next to a chunk resolved from 0.9.1 for up
  to a week. With stable chunk names this is caught by the version handshake
  (a loud card telling the author to pin), or by a link error because
  Rollup's minified export names differ. It never runs silently wrong. Docs
  recommend unpkg ranges or exact jsDelivr versions.
- **esm.sh** (documented as an alternative, and the CLI preview fallback)
  rebuilds from the npm build. Its dynamic imports become esm.sh URLs pinned
  to the resolved version. This needs **verification on the first 0.9 alpha**
  (extend `scripts/verify-alpha-publish.sh`); it cannot be tested locally.
- **Import maps.** Chunks only use relative specifiers plus the bare
  `maplibre-gl`, which the page's import map already maps, so nothing new is
  required. Verified on a plain HTML page with an import map: all variants
  rendered (screenshots in `~/crosshatch-proto/lazyload/`).
- **Self-hosting and renamed copies.** Lazy chunks import back from
  `../register.browser.js`. A copy served under **another name** gets a second
  module instance. The documented root shim (`register.js` →
  `./dist/register.browser.js`) is fine. Anything that serves the bundle under
  a different file name breaks, **including the CLI preview server, which
  serves `dist/register.browser.js` at `/…/register.js` and serves nothing
  else**. Fixes:
  1. The CLI preview serves the whole `dist/` directory under real names.
  2. Docs say "copy the whole `dist/` folder".
  3. `register` detects a second copy (`customElements.get("ml-map")` already
     defined by a different class) and warns with both URLs instead of
     throwing `NotSupportedError`.

  The alternative is a facade entry plus `chunks/core.js`, which makes renaming
  safe. It costs one more round trip on every page; see open question Q4.

### 2.6 Bundlers, Astro, React, SSR

- **Vite / Astro / React (Vite).** They use the npm build's literal
  `import()`s. Verified with a Vite 6 app: main chunk 106.9 kB (Phase-1-like
  prototype) and 36.7 kB (proto-c), with on-demand chunks emitted alongside.
- **webpack 5** splits on `import()` the same way, with `publicPath: "auto"`.
  The loader adds `/* webpackChunkName: "mlym-story" */` comments for readable
  names. Not tested here; an implementation unit should add a minimal webpack
  fixture to the Astro/React matrix job.
- **Astro components** should skip the detect-on-sight round trip where they
  already know:
  - `Scrollytelling.astro` imports `@maplibre-yaml/core/story`, a new subpath
    that statically includes and defines the story element.
  - `Map.astro` with a `config` prop validates on the server (it has the
    parser in frontmatter for free). It passes the validated document with a
    marker, so the browser skips the `parse` chunk entirely (Phase 2, §3 lever
    A). On a validation failure it passes the errors, so the browser shows the
    card with only the `messages` chunk.
- **SSR.** Dynamic imports are inert at module evaluation, so nothing new runs
  on the server. The pre-existing crash when `/register` is imported in Node
  (`class MLMap extends HTMLElement` at module scope) is separate. The fix is
  cheap (`const Base = globalThis.HTMLElement ?? class {}`) and fits Phase 1;
  it is now tracked as ml-7qa.6.

### 2.7 Behaviour and API changes the split implies

| Change | Who notices | Mitigation |
|---|---|---|
| The error card and notices render after the `messages` chunk loads, one task to one round trip later | 10 unit tests that assert the card synchronously (`ml-map-student-errors`, `ml-map-config-lifecycle`, `ml-map-effects`, `ml-map`), all reproduced in the prototype | Tests await a new internal `whenSettled()`; the card's DOM shape is unchanged |
| `ml-map:error` for **fetch failures** carries catalogue prose, so it fires after the chunk loads | listeners measuring timing (none found in docs) | Dispatch keeps its order relative to other events; documented |
| Validation errors from the parser fire `ml-map:error` **synchronously, as today** (the prose is built by the parser, not the catalogue) | — | — |
| `MLScrollytelling` (the class) is no longer a named export of `/register`; `registerMLScrollytelling()` returns a `Promise` | code that subclassed or `instanceof`-checked the story class via `/register` | Still exported from `/components` and the new `/story` subpath. **Minor-version API change, needs a changeset note** (Q2) |
| `@maplibre-yaml/core/maplibre` becomes async-ready (Phase 1 with lazy maplibre-gl) | pages that call `addProtocol` from `/maplibre` before any map (PMTiles today) | `await ready()` / `addProtocol` queues until loaded (Q3); ml-cnv makes the PMTiles case YAML-only anyway |

### 2.8 Interaction with ml-aot.57 (dev-only author hints)

The notice split (failures always, author hints in dev only) pairs naturally
with the `messages` chunk:

- Production pages with no problems never load it.
- Author hints come from diagnostics in the parse stage plus catalogue wording
  in `messages`, so they cost nothing on the happy path.
- The dev-detection mechanism stays ml-aot.57's decision: Vite/Astro
  `import.meta.env.DEV`, or an explicit `debug` attribute on the CDN. Lazy
  loading does not constrain it.

---

## 3. Bigger levers

| # | Lever | Measured effect | Recommendation |
|---|---|---|---|
| A | **Prevalidated config from the server (Astro).** `Map.astro` already has the config at build time; validate there and hand the browser the validated document | the browser never loads `parse`: **−71 kB gzip (−58%)**; render core measured at **33.2 kB** before the other splits, ~26 kB after | **Recommend (Phase 2).** Security: the marker is honoured only when set by the component, not from user HTML. A plain `<ml-map config>` without the marker still validates. Dev mode can keep browser validation for live hints if ml-aot.57 wants it |
| B | **No `yaml` when `config` is an object** (`<ml-map config>`, React, programmatic). Today `safeParseMapBlockValue` *stringifies the object to YAML and re-parses it* | −30.2 kB gzip on config-object pages that are not prevalidated | **Recommend (Phase 2).** Validate the value directly. Positions are already stripped on this path. The fan-out (alias-bomb) guard is moot for a JS object. Sugar expansion and source-reference checks take an optional `Document`/`LineCounter` |
| C | **Strip `.describe()` strings from the browser build.** 482 calls; nothing reads `.description` at runtime (grep) | **−6.6 kB gzip / −5.1 brotli** (measured, all 482 stripped) | **Recommend (Phase 1), browser build only.** The npm build keeps them: JSON-Schema emit runs at build time, and consumers such as map-party may read descriptions. Guard: a unit test asserts that browser-build schemas still validate the canonical corpus identically |
| D | **Light validation in the browser, full `zod` only on error or in dev** | would save ~14–24 kB | **Reject.** `zod` applies **58 `.default()`s** the renderer consumes, so a light path is a second source of truth for defaults. Did-you-mean warnings run on *successful* parses, so a "load on error" path silently loses them. Lever A gets the saving where it is safe |
| E | **Replace `yaml` with a smaller parser** (js-yaml 4: 13.3 kB vs `yaml` 30.3 kB for the APIs we use; `yaml` does not tree-shake: parse-only = full) | −17 kB | **Reject.** We lose the CST, so line/column on every error (a core strength), the merge-key and `!html` handling, and `maxAliasCount` (the alias-bomb guard). A two-parser "fast path + rich re-parse on error" also fails, because positioned warnings run on success |
| F | **zod 3 → zod 4 mini** | runtime for the same API surface: zod3 14.3 kB, zod4 classic 15.4, **zod4 mini 8.6** (−5.7 kB) | **Defer to the 1.0 stability window.** It means rewriting 9 schema files to the functional API, replacing `zod-to-json-schema`, and changing the zod types the public API exports (breaking). The parse stage is lazy and skippable after Phase 2, so the win shrinks to CDN pages only |
| G | **Tree-shake the schemas barrel**: story/page/content schemas ride on map-only pages because `YAMLParser` references every root schema | −2.1 kB gzip on non-story pages | **Phase 3.** Move story/page validation behind the story chunk (or `parse:story`) |
| H | **Minify the embedded story CSS** | −0.3 to −1.1 kB gzip, **story pages only** once split | **Recommend (Phase 1),** as part of building the story chunk (minify at build, e.g. lightningcss, already in the tree) |

---

## 4. Prototype results

All prototypes are scratch copies of PR #156's `packages/core`
(`~/dev/lazy-loading-spike/{proto,proto-b,proto-c}`). None are in this PR.

- **proto**: `<ml-scrollytelling>` defined on sight (DOM check +
  MutationObserver), with `registerMLScrollytelling()` as a `Promise`. The
  error card, message catalogue and notice sit behind `loadErrorUI()`. A tiny
  eager `page-helpers.ts` keeps `isFilePage`, `looksLikeHtml`, `resolveUrl`
  and `ERROR_CARD_CLASS` sync. There is a plain-text fallback card if the
  chunk fails.
- **proto-b**: proto plus the parse stage behind `loadParser()`, started in
  parallel with the `src` fetch.
- **proto-c**: proto-b plus lazy `maplibre-gl`, started at register time.

### 4.1 Sizes (gzip kB; Rollup unless noted)

| Build | Entry | Lazy chunks | Plain page | Story page | Error page |
|---|---:|---|---:|---:|---:|
| 0.8.1 (tsup) | 122.6 | — | 122.6 | 122.6 | 122.6 |
| proto, esbuild split | 0.4 stub + 54.1 + 52.6 | story 13.2, shared 3.5, error-ui 2.8 | 107.1 (3 files) | 123.8 | 113.4 |
| **proto** | **103.7** | story 13.2, student-messages 3.5, error-ui 2.8 | **103.7** | 120.4 | 110.0 |
| proto + `describe()` strip | **97.1** | same | **97.1** | 113.8 | 103.4 |
| proto-b/c + strip | **33.2** (render core) | yaml-parser 34.2, validation-utils (yaml+zod) 32.7, story 13.2, messages 3.5, error-ui 2.8 | 100.1 (3 files) CDN / **33.2 prevalidated** | 116.8 | 106.4 |
| Vite app on proto npm build | 106.9 | story 13.8, shared 3.5, error-ui 2.9 | 106.9 | — | — |
| Vite app on proto-c npm build | 36.7 | parse 39.9 + 33.2, … | 36.7 + parse | — | — |

Phase 1 estimate: proto + strip (97.1) − live (3.2) − loading UI (0.8) −
interactions (3.4) ≈ **90 kB**. Interactions and live were not prototyped;
their numbers are attribution marginals (§1.1), which matched the prototype
within 1 kB for story and messages.

### 4.2 Unit-test fallout (signal for implementation effort)

The core suite has 2,116 tests. The 7 `json-schema-roundtrip` failures are an
artefact of the scratch copy, which has no CLI templates, and are excluded
below.

- **proto: 10 tests fail** in 4 files. All of them assert the card or notice
  synchronously after an error.
- **proto-c: 181 tests fail** in 24 files, with two causes:
  1. **Test harness.** Renderer and interaction tests build `MapRenderer`
     directly against a mocked `maplibre-gl`. With lazy maplibre the
     `export let` bindings are unset until `loadMaplibre()` runs, so 38 fail
     as `Map is not a constructor`. A shared `beforeAll(loadMaplibre)` in the
     vitest setup fixes the whole class.
  2. **Async parse.** Element tests expect a rendered map or a card in the
     same tick as `config =` or connect. They need to await `whenSettled()`.

None of these is a behavioural regression; the prototype renders all four
pages correctly in a real browser. **Implementation cost:** 1g and 2a each
carry a mechanical test-migration commit, roughly a day each. This is why 1g
needs the test helper first.

### 4.3 Screenshots

`~/crosshatch-proto/lazyload/`: every page × variant × profile, including:

- `none-story-core@0.9.0-proto.png` (story rendered from the lazy chunk)
- `none-error-core@0.9.0-proto.png` (full card from the lazy catalogue)
- `none-core_0.9.0-proto-404_error.html.png` (plain-text fallback card when
  the catalogue chunk 404s)
- `none-core_0.9.0-proto-404_story.html.png` (blank: the case the required-
  feature fallback must cover)

---

## 5. Budgets and CI (ml-7qa.1)

**Tooling:** a dependency-free `scripts/size-budget.mjs`. It runs after
`pnpm build` and measures gzip-9 and brotli-11 of each named browser chunk,
plus *page scenarios*: the entry's static closure plus the chunks a feature
set loads (plain, popups, story, error, prevalidated). It compares them with
`packages/core/size-budget.json`. It runs in the existing CI `build` job and
in `pnpm presubmit` (after `build`, before `typecheck`). It fails on any
budget overrun and prints a delta table. A PR comment is optional and later.

**Graph assertions** (cheap and catch real regressions; read from Rollup's
bundle metadata, written to `dist/chunk-manifest.json`):

1. The entry's module list contains **no** module from the story,
   catalogue, interactions, live, parse (Phase 2) or emitter areas.
2. No lazy chunk statically imports another lazy chunk unless it is listed in
   the preload map.
3. `register.browser` contains no `emitter/` or `export/` module.
4. Every chunk exports `VERSION`.

**Proposed budgets (gzip kB, ~5% headroom over the projected size; brotli
tracked, not gated):**

| Chunk / scenario | After Phase 1 | After Phase 2 |
|---|---:|---:|
| `register.browser.js` (entry) | **95** | **30** |
| `chunks/parse.js` (+ its deps) | — | 72 |
| `chunks/story.js` | 15 | 15 |
| `chunks/messages.js` | 7 | 7 |
| `chunks/interactions.js` | 5 | 5 |
| `chunks/live.js` | 5 | 5 |
| scenario: plain CDN page | 95 | 100 |
| scenario: prevalidated (Astro) page | — | 32 |
| scenario: story page | 112 | 116 |
| `index.browser.js` (tooling, unsplit) | current + 5% | ″ |
| `page.schema` `.d.ts` (ml-7qa.3) | current (gate growth now) | 200 kB after the diet |

**Ratchet policy:** budgets only go down without review. Raising one needs a
`size-budget.json` change in the PR, which shows up in the diff. A shrink of
more than 5% prints a "tighten the budget" hint.

---

## 6. Phased implementation

Each unit is a separate PR with its own changeset where the published surface
changes (all core units do). Each demo-bearing unit ships a browser twin under
`e2e/`: a lazy-chunks spec that counts requests per page type and asserts the
plain page loads no story/messages/interactions/live chunk.

| Phase | Unit | Contents | Expected saving | Bead |
|---|---|---|---|---|
| **0** (now, 0.8.x) | 0a | Size-budget script + current budgets (gate growth); graph assertion "no emitter in register.browser" | — (prevents regressions) | ml-7qa.1 |
| | 0b | Docs/CLI-template **preload snippet** (+ `script src` → `dist/register.browser.js`) | **−2.2 s** `ml-map:load` on Fast 3G, no code | ml-7qa.7 |
| **1** (0.9.0) | 1a | Browser build → Rollup (stable chunk names, preload map, `VERSION` handshake); npm build `splitting: true`; `index.browser` separate; CLI preview serves `dist/`; double-load warning | enabler; −2 kB from Rollup alone | ml-7qa.5 |
| | 1b | `story` chunk + `/story` subpath + `Scrollytelling.astro` static import; minified story CSS; required-feature fallback card | −12.8 kB on non-story pages | ml-7qa.5 |
| | 1c | `messages` chunk (card, catalogue, notice); async card with generation tokens; tests await `whenSettled()` | −6.3 kB on pages without problems | ml-7qa.5 |
| | 1d | `live` chunk (polling/SSE/WS/merge/retry/loading UI); `LayerManager` constructs them lazily | −4 kB | ml-7qa.2 |
| | 1e | `interactions` chunk, attached at map load | −3.4 kB on 87% of pages | ml-7qa.5 |
| | 1f | `describe()` strip (browser build) | −6.6 kB everywhere (CDN) | ml-7qa.5 |
| | 1g | **Lazy `maplibre-gl`** started at register; `/maplibre` async-ready | −0.7 to −1.0 s `ml-map:load` (Fast 3G); removes the lazy-chunk regressions | ml-7qa.5 |
| | 1h | SSR-safe `/register` (HTMLElement guard) | unblocks Next/SvelteKit | ml-7qa.6 |
| **2** (0.9.x) | 2a | `parse` chunk fetched in parallel with `src`; catalogue decoupled from schemas | ~0 bytes on CDN, enables 2b/2c | ml-7qa.5 |
| | 2b | Object `config` validates without `yaml` | −30 kB (config-object pages) | ml-7qa.5 |
| | 2c | Astro prevalidated config (server validates; errors passed through) | **plain Astro map page ~26 kB (−79%)** | ml-7qa.5 / astro |
| **3** (if budgets demand) | 3a | `extras` chunk (legend, params, markers, images, 3D) | −3.1 kB | — |
| | 3b | Story/page schemas move to the story side | −2.1 kB on non-story pages | — |
| | 3c | zod 4 mini (1.0 window) | −5.7 kB (CDN parse) | — |
| **ml-cnv** | — | Format decoders as `format:*` features (§9) | 0 kB for pages without them | ml-cnv.* |

**Ordering rationale:** 0a first, so every later PR shows its delta. 1a before
any split (the esbuild layout regresses latency). 1g lands **in the same
release** as 1b/1c, because without it story and error pages get slower on
slow networks (measured +1.1 s and +1.0 s on Fast 3G).

---

## 7. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Story/error pages get *slower* (chunk behind maplibre-gl, chunk-to-chunk hops) | **Measured**, certain without 1g + the preload map | Ship 1g with 1b/1c; graph assertion #2; e2e latency smoke test at Fast 3G (generous threshold, catches waterfalls not noise) |
| Mixed versions from jsDelivr ranges | Low (week-long cache skew) | Version handshake + loud card; docs recommend unpkg or exact versions |
| Renamed/self-hosted copies get a second module instance | Medium (CLI preview does it today) | Fix the CLI preview; docs; double-load detection; Q4's facade alternative |
| Async card races (a card from an old config over a new map) | Medium | Generation tokens; lifecycle unit tests already cover re-render paths |
| Maintenance cost of two bundlers (Rollup browser, esbuild npm) | Medium | Same source, same `import()` sites; CI builds both and runs the e2e matrix on the browser build. A later move to one tool (tsdown/rolldown) is an option, not a prerequisite |
| `describe()` strip changes validation | Low | Regex-free implementation (TS AST transform or `z.ZodType.prototype.describe` no-op shim in the browser build); corpus-equivalence test |
| esm.sh behaves differently with chunks | Unknown | Verify on the first alpha (`verify-alpha-publish.sh`) |
| Lazy `maplibre-gl` breaks hosts that rely on the `/maplibre` sync exports | Low/medium | Q3; keep a sync path for hosts that import maplibre-gl themselves first |

---

## 8. Open questions for the maintainer

1. **Scope of 0.9.0.** Phase 1 in full (including lazy `maplibre-gl`), with
   Phase 2 in a 0.9.x? Or the minimum (1a–1c + 1g) first?
2. **`/register` exports.** OK to drop the `MLScrollytelling` class from
   `/register` (it stays in `/components` and the new `/story`), and to make
   `registerMLScrollytelling()` return a `Promise`? A minor bump with a
   changeset note, or hold for 1.0?
3. **`@maplibre-yaml/core/maplibre` with lazy maplibre-gl.** Option (a): make
   `addProtocol` & co. queue until maplibre-gl loads. Option (b): require
   `await ready()`. Option (c): keep the module eager, so pages that import
   `/maplibre` pay the old waterfall. (c) is the safe default, and ml-cnv
   removes the main reason to import it.
4. **Renamed copies vs one more round trip.** Accept "serve `dist/` as a
   folder" (plus detection and a warning), or ship a facade entry plus
   `chunks/core.js` that tolerates renaming at a cost of +1 round trip (~0.6 s
   on Fast 3G, ~0.15 s on 4G) on every page?
5. **Prevalidated Astro configs (lever A).** OK for `Map.astro` to validate on
   the server and skip browser validation in production? In dev, should the
   browser still validate (live did-you-mean notices, ml-aot.57), or should
   server-reported hints be enough?
6. **`describe()` in the npm build.** Strip only in the browser build (as
   proposed), or also offer a stripped schemas build for bundler consumers
   (−6.6 kB for Astro/React too, at the cost of a second schema artefact)?
7. **Budget strictness.** Gate on gzip only (proposed), or also brotli? Gate
   page scenarios, or only per-chunk sizes?
8. **Preload snippet now.** Ship the docs/template preload snippet in a 0.8.x
   docs PR (−2.2 s, no code), ahead of 0.9?

---

## 9. Coordination — cloud-native decoders (ml-cnv)

The ml-cnv design spike (branch `docs/plan-cloud-native-formats`, file
`docs/plans/2026-10-18-cloud-native-formats-design.md`) had not been pushed
when this plan was written. The points below are this plan's proposal for the
interface. They are to be mirrored in that doc's own Coordination section and
reconciled there.

**Proposed agreements:**

1. **Every decoder is a `format:<name>` lazy feature** (§2.3), with its own
   chunk (`chunks/format-pmtiles.js`, …), its own budget line, and zero bytes
   on pages that do not use it. Decoders are never part of the entry.
2. **Detection is static, on the parsed document.** Examples: a `pmtiles://`
   URL or `type: pmtiles`; a `.tif`/`cog://` raster or raster-dem; a
   `.fgb`/`type: flatgeobuf` source; a `.parquet`/`type: geoparquet` source.
   No network sniffing at detection time, so detection runs before any fetch.
3. **Stages.** Protocol-based formats (PMTiles, COG) are `before-map`: the
   protocol is registered before `new Map()` and the style load, and the chunk
   is fetched in parallel with maplibre-gl. Data formats that convert to
   GeoJSON (FlatGeobuf, GeoParquet) are `data`: they are awaited by the layer
   manager before that source is added, so other layers render without
   waiting.
4. **Install contract.** A decoder chunk exports
   `install(ctx: { maplibregl, addProtocol, signal })`. It receives
   maplibre-gl from the loader (compatible with lazy `maplibre-gl`, 1g), and
   never imports `maplibre-gl` or `/maplibre` itself.
5. **Packaging.** The third-party decoder libraries become regular
   `dependencies` of core, reached only through `import()`. This costs install
   size, not bundle size. Optional peers would break bundler builds (an
   unresolved `import("pmtiles")` fails at build time). The CDN browser build
   bundles each library into its decoder chunk, so plain HTML works with no
   extra import-map entries.
6. **Large decoders** (anything with WASM, e.g. a parquet reader) load their
   WASM relative to the chunk (`new URL("./x.wasm", import.meta.url)`). They
   get a separate budget line and are exempt from the "≤ 1 round trip" rule.
7. **Failure** of a decoder chunk is a *required-feature* failure for that
   source only: the plain-text card if no layer can render, otherwise a
   notice naming the source.

**Open points for the ml-cnv spike:** decoder library choices and their
measured chunk sizes; whether GeoParquet's reader size justifies a
size-warning in `validate`; whether COG needs a worker.

---

## Appendix A — reproducing the numbers

Scratch root: `~/dev/lazy-loading-spike/`

| Path | What |
|---|---|
| `base081/`, `main080/` | `git archive` of `packages/core` at PR #156 head / `origin/main` |
| `measure/build.mjs` | esbuild replica of tsup's browser build with a metafile (`--split`, `--npm`) |
| `measure/attr.mjs` | per-area source-map attribution (marginal/own gzip+brotli) |
| `measure/levers.mjs` | `describe()` strip, `yaml`/js-yaml, zod 3/4/4-mini sizes |
| `measure/vite-lib.mjs` | Rollup (Vite 6 lib mode) browser build; `STRIP=1`, `MANUAL=1` |
| `measure/vite-app.mjs` | a Vite 6 app consuming an npm-style `dist/register.js` |
| `measure/sizes.mjs` | per-file gzip/brotli + static/dynamic import graph |
| `proto-edit.py`, `proto-b-edit.py`, `proto-c-edit.py` | the prototype source edits |
| `census/feature-census.js` | the 321-document feature census (`census.txt`, `census.json`) |
| `cdn/setup*.mjs`, `cdn/server.mjs` | hermetic fake-unpkg tree (gzip) on port 4511 |
| `cdn/measure.cjs`, `cdn/waterfall.cjs` | Playwright + CDP throttling (Fast 3G / Slow 4G), medians of 3, waterfalls |
| `cdn/*.log`, `cdn/*.json` | raw results |
