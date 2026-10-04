# MapLibre examples gallery in YAML — triage (ml-chh / ml-chh.1)

Re-express the official MapLibre GL JS examples gallery
(https://maplibre.org/maplibre-gl-js/docs/examples/) as maplibre-yaml
documents. Dual purpose: a browsable docs-site gallery ("here is the map you
know, in N lines of YAML") and an empirical capability census — every example
either expresses cleanly, needs a documented escape hatch, or exposes a gap.

Triage date: 2026-09-26, against the upstream index (139 examples, verified
1:1 against `maplibre/maplibre-gl-js` `test/examples/`) and the library at
`core@0.6.0-alpha.0`. Open work items live in beads under **ml-chh**, not
here; this doc records the verdicts and the reasoning.

## Verdicts

- **E — expressible today.** Pure YAML renders it under `<ml-map>` (or the
  Astro components where noted). Gallery page = YAML document. 49 examples.
- **H — escape hatch.** Demonstrable, but needs one of the documented
  hatches: `getMap()` + a few lines of JS, an inline basemap style object,
  raw MapLibre expressions beyond the curated keys, or a protocol plugin.
  Gallery pages here show YAML + minimal JS and are honest about the seam —
  they are the "Beyond YAML" story (ml-alp.9). 41 examples.
- **G — gap.** A YAML surface that plausibly should exist and doesn't;
  each gap theme is filed as a bead under ml-chh. 15 examples.
- **X — out of scope.** Deep imperative/plugin territory (three.js custom
  layers, draw tools, geocoder UI, rAF game loops) that a declarative format
  should not chase. The gallery skips these or links out. 34 examples.

Summary: **49 E / 41 H / 15 G / 34 X**. Excluding X, ~62% of the
replicable gallery is pure YAML today and ~86% is reachable with documented
hatches.

## Gap themes (filed as beads under ml-chh)

| Theme | Examples driving it | Notes |
|---|---|---|
| Markers & standalone annotations | add-a-default-marker, add-custom-icons-with-markers, display-a-popup, attach-a-popup-to-a-marker-instance | No `maplibregl.Marker` surface at all; no popup-at-coords without an interaction. Biggest single absence by example count. |
| `terrain:` map-level 3D | 3d-terrain, display-a-hybrid-satellite-map-with-terrain-elevation | Currently a *declared* non-goal (source.schema.ts, docs). This census is the evidence to revisit: raster-dem sourcing already exists, only the map-level switch is missing. |
| `projection:` / globe | display-a-globe-with-a-vector-map, -with-an-atmosphere, -with-a-fill-extrusion-layer, heatmap-on-globe | No surface; `spinGlobe` in scrollytelling schema is unimplemented. |
| `sky:` / fog / atmosphere | sky-fog-terrain, display-a-globe-with-an-atmosphere | Emit already inherits `sky`/`light` from basemap; authoring is the gap. |
| `images:` — icon/image loading | add-an-icon-to-the-map (anchor; 6 more ride it as H) | No `map.addImage`/sprite surface; symbol layers limited to basemap sprite icons. A declarative `images: {name: url}` block covers most icon examples. |
| Hover popup built-in | display-a-popup-on-hover | Hover has only `highlight`; ml-fn9 (hover-emit) builds the registry-contract change a hover popup also needs. |
| `color-relief` layer type | add-a-color-relief-layer | MapLibre v5 layer type absent from the 9-type union; pairs with ml-tfd.1 (v5 CI matrix). |
| Fit-to-data initial camera | fit-to-the-bounds-of-a-linestring | `config.bounds` takes literal bounds only; no "fit to this source/feature" — natural sugar given zoomToFeature already computes feature bounds. |
| State/parameter control UI | filter-* (4), create-a-time-slider, change-a-layers-color-with-buttons | `state:`/`parameters:` + `global-state` expressions exist, but there is no built-in UI and no documented host recipe; `toggleable:` is accepted with no consumer. Also the natural home for a layer-toggle panel. |
| Curated-key refresh vs current style-spec | fill-extrusion-rounded-corners, variable-label-placement-with-offset, multidirectional hillshade, cooperative-gestures | Valid spec keys ride `.passthrough()` but emit unknown-key warnings (`mlym validate` promotes to errors in CI); refresh curated lists against v5 spec. |

Plus one straight **bug** found during triage (filed top-level, not under
ml-chh): `background` layers are schema-valid and emit fine, but
`LayerManager.addLayer` unconditionally reads `layer.source.type`, so a
background layer throws under `<ml-map>`.

## Existing beads this census reinforces (not re-filed)

- **ml-1lz** — click.emit live under `<ml-map>` (several H verdicts get
  cleaner once host events work end-to-end).
- **ml-fn9** — hover-emit (in progress; prerequisite thinking for hover popup).
- **ml-3e9** — `=`-prefix expression DSL (all expression examples currently
  author raw MapLibre arrays; fine for parity, DSL would shrink them).
- **ml-tfd.1** — maplibre-gl v5 CI matrix (color-relief, v5 paint keys).
- **ml-alp.9** — "Beyond YAML" page (the H column is its example corpus).
- **ml-ddg** — GeoJSON sugar on scrollytelling layer sources.

## Full triage table

Verdict key: E = expressible today · H = escape hatch · G = gap · X = out of scope.

### Map basics

| example | v | how / what's missing |
|---|---|---|
| display-a-map | E | `type: map` + `config.center/zoom` + basemap URL |
| display-a-satellite-map | E | raster source + raster layer |
| display-a-non-interactive-map | E | `config.interactive: false` |
| change-the-default-position-for-attribution | E | `controls.attribution: {position: top-left}` |
| check-if-webgl-is-supported | X | capability probe, not a map document |
| display-a-map-with-mlt | H | MLT needs its protocol plugin registered in JS before `<ml-map>` init |

### Camera & animation

| example | v | how / what's missing |
|---|---|---|
| fly-to-a-location | H | no declarative runtime camera outside click interactions; `getMap().flyTo()` |
| jump-to-a-series-of-locations | H | timer + `jumpTo` via `getMap()` |
| set-pitch-and-bearing | E | `config.pitch` / `config.bearing` |
| slowly-fly-to-a-location | H | `flyTo` options via `getMap()` |
| animate-a-line | H | rAF `setData` loop; YAML streaming (`stream:`) is the declarative cousin |
| animate-a-point | H | rAF `setData` loop |
| animate-a-point-along-a-route | H | Turf + rAF |
| animate-map-camera-around-a-point | H | `rotateTo` loop |
| customize-camera-animations | H | AnimationOptions via `getMap()` |
| customize-the-map-transform-constrain | X | transform internals |
| enter-a-360-photosphere | X | bespoke immersive UI |
| fit-a-map-to-a-bounding-box | E | `config.bounds` |
| fit-to-the-bounds-of-a-linestring | E | `config.fitTo: { source }` — shipped in 0.7 U14 (ml-chh.9); was G (fit-to-data gap) |
| fly-to-a-location-based-on-scroll-position | E | Astro `Scrollytelling` — this is the library's home turf |
| hash-routing | E | `config.hash: true` |
| level-of-detail-control | X | LoD internals |
| offset-the-vanishing-point-using-padding | H | camera padding via `getMap().easeTo({padding})` |
| render-world-copies | E | `config.renderWorldCopies` |
| restrict-map-panning-to-an-area | E | `config.maxBounds` |
| set-center-point-above-ground | H | v5 `elevation`/`centerClampedToGround`; may ride config passthrough, unverified |
| walk-around-a-map-in-first-person | X | game-loop camera |

### Controls & gestures

| example | v | how / what's missing |
|---|---|---|
| display-map-navigation-controls | E | `controls.navigation` |
| locate-the-user | E | `controls.geolocate` (options hardcoded: high-accuracy + track) |
| cooperative-gestures | E | `config.cooperativeGestures` rides open-schema passthrough (curated-key theme) |
| disable-map-rotation | E | `config.dragRotate: false` (touch rotate-disable needs JS; note on page) |
| disable-scroll-zoom | E | `config.scrollZoom: false` |
| navigate-the-map-with-game-like-controls | X | keyboard game loop |
| toggle-interactions | H | runtime handler enable/disable via `getMap()` |
| view-a-fullscreen-map | E | `controls.fullscreen` |

### Sources & data

| example | v | how / what's missing |
|---|---|---|
| add-a-vector-tile-source | E | vector source + source-layer |
| add-a-geojson-line | E | `route:` sugar — shorter than the original |
| add-a-geojson-polygon | E | `region:` sugar |
| draw-geojson-points | E | `locations:` sugar |
| add-multiple-geometries-from-one-geojson-source | E | named source, two layers |
| display-line-that-crosses-180th-meridian | E | plain GeoJSON line |
| view-local-geojson | X | FileReader upload UI |
| view-local-geojson-experimental | X | File System Access API |
| add-a-raster-tile-source | E | raster tiles |
| add-a-wms-source | E | WMS as raster tile URL template |
| add-a-canvas-source | H | no `canvas` source type; content is JS-drawn anyway |
| add-a-cog-raster-source | H | COG protocol plugin (protocol theme) |
| add-a-video | E | video source + raster layer |
| animate-a-series-of-images | H | `updateImage` loop via `getMap()` |
| add-live-realtime-data | E | `refresh:` polling or `stream:` (SSE/WS) — stronger than the original example |
| update-a-feature-in-realtime | E | `refresh: {updateStrategy: replace}` |
| update-geojson-polygons | H | updateable GeoJSON-VT API |

### Layers, icons & styling

| example | v | how / what's missing |
|---|---|---|
| add-an-icon-to-the-map | **G** | no image-loading surface (`images:` gap theme anchor) |
| add-a-generated-icon-to-the-map | H | runtime canvas generation, `getMap().addImage` |
| add-a-stretchable-image-to-the-map | H | `addImage` with stretch options (images theme) |
| add-an-animated-icon-to-the-map | H | animated canvas `addImage` |
| animate-an-icon-on-the-gpu | X | WebGL atlas writes |
| display-a-remote-svg-symbol | H | missing-image resolver callback |
| elevate-symbols-above-the-terrain | H | needs terrain (gap theme) + v5 symbol prop |
| generate-and-add-a-missing-icon-to-the-map | H | `styleimagemissing` handler |
| use-a-fallback-image | H | `coalesce` image expression works, but icons must exist (images theme) |
| change-a-layers-color-with-buttons | H | `setPaintProperty` via `getMap()`; `state:` + `global-state` color is the declarative alternative (params-UI theme) |
| add-a-new-layer-below-labels | E | `before:` |
| add-a-custom-style-layer | X | custom WebGL layer |
| add-a-pattern-to-a-polygon | H | `fill-pattern` needs the image in the sprite (images theme) |
| create-a-heatmap-layer | E | heatmap layer, raw expressions |
| create-and-style-clusters | E | `cluster:` + cluster layers; expansion-zoom click needs a JS line (note) |
| display-html-clusters-with-custom-properties | X | HTML markers |
| visualize-population-density | E | `let`/`var` expression verbatim |
| measure-distances | X | interactive Turf tool |
| create-a-time-slider | H | `global-state` filter + host slider (params-UI theme) |
| draw-a-circle | H | Turf-generated polygon (precomputed data would be E) |

### Expressions & filtering

| example | v | how / what's missing |
|---|---|---|
| style-lines-with-a-data-driven-property | E | raw data expression on `line-color` |
| change-building-color-based-on-zoom-level | E | `interpolate` on zoom |
| create-a-gradient-dashed-line-using-an-expression | E | `line-gradient` + `line-dasharray` + `lineMetrics: true` |
| create-a-gradient-line-using-an-expression | E | `line-gradient` + `lineMetrics: true` |
| filter-within-a-layer | H | runtime `setFilter` from UI (params-UI theme; `global-state` alternative) |
| filter-symbols-by-text-input | H | same |
| filter-layer-symbols-using-global-state | H | map config fully YAML (`state:` + `global-state` filter); the text input + `setGlobalStateProperty` is host JS. Closest H to E. |
| filter-symbols-by-toggling-a-list | H | same; also the natural `toggleable:` consumer (params-UI theme) |

### Terrain, 3D & globe

| example | v | how / what's missing |
|---|---|---|
| 3d-terrain | **G** | `terrain:` map-level field absent (declared non-goal — revisit) |
| add-a-hillshade-layer | E | hillshade layer + raster-dem source |
| add-3d-terrain-from-quantized-mesh-tiles | H | quantized-mesh protocol plugin + terrain gap |
| add-a-color-relief-layer | E | `color-relief` layer type — shipped in 0.7 U14 (ml-chh.8; maplibre-gl ≥ 5.6, declared absence below); was G |
| add-a-multidirectional-hillshade-layer | E | v5 hillshade props ride passthrough (curated-key theme) |
| add-contour-lines | H | maplibre-contour plugin |
| display-a-hybrid-satellite-map-with-terrain-elevation | **G** | terrain theme |
| sky-fog-terrain | **G** | `sky:`/fog authoring absent (theme) |
| display-buildings-in-3d | E | fill-extrusion + interpolate |
| add-a-3d-model-using-threejs | X | custom layer |
| add-3d-tiles-using-threejs | X | custom layer |
| add-a-3d-model-to-globe-using-threejs | X | custom layer |
| add-a-3d-model-with-babylonjs | X | custom layer |
| add-a-3d-model-with-shadow-using-threejs | X | custom layer |
| adding-3d-models-using-threejs-on-terrain | X | custom layer |
| extrude-polygons-for-3d-indoor-mapping | E | `fill-extrusion-height`/`-base` from properties |
| fill-extrusion-rounded-corners | E | v5 key rides passthrough (curated-key theme) |
| display-a-globe-with-a-vector-map | **G** | `projection:` absent (globe theme) |
| display-a-globe-with-an-atmosphere | **G** | globe + sky themes |
| add-a-custom-layer-with-tiles-to-a-globe | X | custom layer |
| add-a-simple-custom-layer-on-a-globe | X | custom layer |
| create-a-heatmap-layer-on-a-globe-with-terrain-elevation | **G** | globe + terrain themes |
| display-a-globe-with-a-fill-extrusion-layer | **G** | globe theme |
| zoom-and-planet-size-relation-on-globe | X | conceptual explainer |

### Markers & popups

| example | v | how / what's missing |
|---|---|---|
| add-a-default-marker | **G** | no marker surface (theme anchor) |
| add-custom-icons-with-markers | **G** | markers theme |
| create-a-draggable-marker | X | drag interaction |
| animate-a-marker | X | rAF loop |
| create-a-draggable-point | X | drag events on layer |
| display-a-popup | E | root `popups:` (popup at a coordinate, no layer/marker) — shipped in 0.7 U14; was G |
| display-a-popup-on-click | E | `interactive.click.popup` — flagship parity page |
| display-a-popup-on-hover | **G** | hover has only `highlight` (hover-popup theme; relates ml-fn9) |
| attach-a-popup-to-a-marker-instance | **G** | markers theme |

### Labels & internationalization

| example | v | how / what's missing |
|---|---|---|
| display-and-style-rich-text-labels | E | `format` expression in `text-field` |
| style-labels-with-web-fonts | H | `glyphs`/fonts via inline basemap object |
| style-labels-with-font-faces | H | v5 font-faces via inline basemap |
| change-the-case-of-labels | E | `upcase`/`downcase` expressions |
| style-labels-with-local-fonts | H | font-stack override via inline basemap |
| variable-label-placement | E | `text-variable-anchor` (curated) |
| variable-label-placement-with-offset | E | `text-variable-anchor-offset` rides passthrough (curated-key theme) |
| change-a-maps-language | H | runtime `setLayoutProperty`; `global-state` `text-field` is the declarative alternative |
| locale-switching | X | page-UI localization |
| use-locally-generated-ideographs | E | `config.localIdeographFontFamily` |

### Events & user interaction

| example | v | how / what's missing |
|---|---|---|
| get-features-under-the-mouse-pointer | H | `ml-map:layer-hover` DOM event or `queryRenderedFeatures` — good DOM-events showcase |
| create-a-hover-effect | E | `hover.highlight` (highlight color not authorable — note) |
| animate-symbol-to-follow-the-mouse | X | rAF pointer tracking |
| center-the-map-on-a-clicked-symbol | E | `click.zoomToFeature` / `click.flyTo` |
| display-performance-metrics | X | perf instrumentation |
| get-coordinates-of-the-mouse-pointer | H | `getMap()` mousemove |
| select-features-with-boxzoomend-callback | X | boxzoom selection tool |
| show-polygon-information-on-click | E | `click.popup` with `property:` items |

### Plugins, protocols & integrations

| example | v | how / what's missing |
|---|---|---|
| geocode-with-nominatim | X | geocoder plugin UI (no custom-control surface) |
| pmtiles-source-and-protocol | H | protocol plugin before init — strongest candidate for a future `protocols:`/pmtiles surface |
| create-deckgl-layer-using-rest-api | X | deck.gl overlay |
| draw-geometries-with-terra-draw | X | draw plugin |
| draw-polygon-with-mapbox-gl-draw | X | draw plugin |
| sync-movement-of-multiple-maps | X | multi-map sync plugin |
| toggle-deckgl-layer | X | deck.gl |
| use-addprotocol-to-transform-feature-properties | H | `addProtocol` in host JS (protocol theme) |

## Proposed implementation batches

Each shipped page = YAML (+ minimal JS for H) + a browser verification case
(e2e/verify:browser), per the demos-as-regression-tests convention.

1. **Wave 1 — pure-YAML flagship (~20 E pages):** map basics, GeoJSON sugar
   trio, popup-on-click, clusters, heatmap, fill-extrusion, hillshade,
   live-data (polling + SSE), controls, hash/bounds/maxBounds. Highest
   positioning value per unit effort; every page is shorter than its
   upstream original.
2. **Wave 2 — remaining E (~29):** expressions set, labels, camera-config
   set, scrollytelling.
3. **Wave 3 — H pages as the "Beyond YAML" corpus (~15 of the 41):** pick the
   ones that teach a hatch (getMap camera, DOM events, inline basemap fonts,
   pmtiles protocol, global-state filtering). Skip H pages that repeat an
   already-shown hatch.
4. **Gap beads graduate to E pages** as their features land; the gallery is
   the acceptance test.

X pages are skipped; the gallery index can link the upstream originals for
completeness.


## Wave 3 friction log (escape-hatch dogfooding, 2026-09-27)

Input for the 0.7 scoping (ml-7ya). Built 6 hatch pages (fly-to, filter,
color-buttons, features-under-pointer, animate-a-point, web-fonts), each
shipping its JS as a shown-and-tested artifact next to its YAML.

**Blockers found (candidate 0.7 surface):**

- **F1 — `global-state` is undemonstrable in any consumer today.** The
  runtime floor is maplibre-gl 5.6; everything pins v4. Three upstream
  examples (global-state filter, time slider, color-by-state) had to fall
  back to `setFilter`/`setPaintProperty` hatches. ml-tfd.1 (v5) is a
  prerequisite for the state story, not just CI hygiene.
- **F2 — `addProtocol` is unreachable from consumers.** Protocol plugins
  (pmtiles, COG, contours, addProtocol-transform: 4 census examples) must
  register on the maplibre-gl module instance core bundles — core does not
  export it, and a bundled consumer has no global. The pmtiles page could
  not be built at all. Candidate surface: re-export `maplibregl` from core,
  or an addProtocol passthrough, or a `protocols:` config hook.

**Positives (hatches that beat upstream ergonomics):**

- **F3** — the DOM-event surface (`ml-map:layer-hover`) replicated the
  queryRenderedFeatures example with ZERO MapLibre API — plain
  `addEventListener`.
- **F4** — `updateLayerData()` made animate-a-point simpler than upstream
  (no `getSource(...)` bookkeeping).
- **F5** — `getMap()` was one-line access everywhere; the only rough edge
  is readiness (null-guards in every snippet). A documented
  `await`-on-`ml-map:load` idiom (or a promise-returning `mapReady()`)
  would remove the boilerplate.
- **F6** — the inline `mapStyle` object cleanly covered the style-root
  hatch (glyphs); deliberately unvalidated, now documented as such on the
  web-fonts page.
