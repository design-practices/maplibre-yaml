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
- **Ext — extension** (added in the U17 rescore, 2026-10-05). In reach of
  the experimental effects API (`registerEffect()`, `packages/effects`): a
  document names a registered extension on an ordinary static layer, and
  that layer stays the fallback. These rows need a backend that 0.7 does not
  ship, and each backend is a bead. The gallery badge is "Extension".

Summary at triage: **49 E / 41 H / 15 G / 34 X**. Current census: see
"U17 rescore" below. Excluding X, ~62% of the
replicable gallery is pure YAML today and ~86% is reachable with documented
hatches.

## Gap themes (filed as beads under ml-chh)

| Theme | Examples driving it | Notes |
|---|---|---|
| Markers & standalone annotations | add-a-default-marker, add-custom-icons-with-markers, display-a-popup, attach-a-popup-to-a-marker-instance | No `maplibregl.Marker` surface at all; no popup-at-coords without an interaction. Biggest single absence by example count. |
| `terrain:` map-level 3D | 3d-terrain, display-a-hybrid-satellite-map-with-terrain-elevation | **Landed in 0.7 U15 (ml-vw4.5, ml-chh.5)** — the non-goal was reversed; document-root `terrain:`, ejects to style.json. Was: a *declared* non-goal (source.schema.ts, docs). |
| `projection:` / globe | display-a-globe-with-a-vector-map, -with-an-atmosphere, -with-a-fill-extrusion-layer, heatmap-on-globe | **Landed in 0.7 U15 (ml-chh.6)** — `projection:` (maplibre-gl >= 5; 4.x warns and renders mercator). Scrollytelling `spinGlobe` stays documented-unimplemented. |
| `sky:` / fog / atmosphere | sky-fog-terrain, display-a-globe-with-an-atmosphere | **Landed in 0.7 U15 (ml-chh.7)** — `sky:` authoring (maplibre-gl >= 4.5). `light:` remains for U10′. |
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

Verdict key: E = expressible today · H = escape hatch · G = gap · Ext = extension (effects API, backend pending) · X = out of scope.

### Map basics

| example | v | how / what's missing |
|---|---|---|
| display-a-map | E | `type: map` + `config.center/zoom` + basemap URL |
| display-a-satellite-map | E | raster source + raster layer |
| display-a-non-interactive-map | E | `config.interactive: false` |
| change-the-default-position-for-attribution | E | `controls.attribution: {position: top-left}` |
| check-if-webgl-is-supported | H | `<ml-map>` already turns a failed map construction into its on-map error card and `ml-map:error`; a listener replaces upstream's `alert`. Telling no-WebGL apart (`GPUInitializationError`, maplibre-gl ≥ 6.7) needs the original error in the event (ml-chh.17). Rescored in U17; was X (capability probe, not a map document) |
| display-a-map-with-mlt | E | maplibre-gl decodes MLT natively now (TileJSON `encoding: mlt`); just a style URL — re-badged in 0.7 U16; was H (protocol plugin) |

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
| customize-the-map-transform-constrain | H | the constrain function is host code: `setTransformConstrain()` after `mapReady()` (maplibre-gl ≥ 5.10); the sub-zero zoom is set from the same hatch (the schema's floor is 0). Rescored in U17; was X (transform internals) |
| enter-a-360-photosphere | X | a photosphere plugin, plus `maxPitch: 175`, well above the schema's 85° cap (ml-rww). Kept X in the U17 rescore |
| fit-a-map-to-a-bounding-box | E | `config.bounds` |
| fit-to-the-bounds-of-a-linestring | E | `config.fitTo: { source }` — shipped in 0.7 U14 (ml-chh.9); was G (fit-to-data gap) |
| fly-to-a-location-based-on-scroll-position | E | Astro `Scrollytelling` — this is the library's home turf |
| hash-routing | E | `config.hash: true` |
| level-of-detail-control | H | params-panel sliders (`parameters:`) feed `ml-map:parameter-change`, then one `setSourceTileLodParams()` call. Rescored in U17; was X (LoD internals) |
| offset-the-vanishing-point-using-padding | H | camera padding via `getMap().easeTo({padding})` |
| render-world-copies | E | `config.renderWorldCopies` |
| restrict-map-panning-to-an-area | E | `config.maxBounds` |
| set-center-point-above-ground | E | `config.elevation` + `centerClampedToGround` ride passthrough (verified, U16); upstream's `maxPitch: 105` is blocked by the schema's 85° cap (ml-rww) |
| walk-around-a-map-in-first-person | X | a first-person game loop driving the camera every frame, and pitch 90 / `maxPitch: 95` above the 85° cap (ml-rww). Kept X in the U17 rescore |

### Controls & gestures

| example | v | how / what's missing |
|---|---|---|
| display-map-navigation-controls | E | `controls.navigation` |
| locate-the-user | E | `controls.geolocate` (options hardcoded: high-accuracy + track) |
| cooperative-gestures | E | `config.cooperativeGestures` rides open-schema passthrough (curated-key theme) |
| disable-map-rotation | E | `config.dragRotate: false` (touch rotate-disable needs JS; note on page) |
| disable-scroll-zoom | E | `config.scrollZoom: false` |
| navigate-the-map-with-game-like-controls | H | `interactive: false` is YAML; the arrow keys call `panBy`/`easeTo` after `mapReady()`, the same camera hatch as fly-to. Rescored in U17; was X (keyboard game loop) |
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
| view-local-geojson | H | the YAML declares an empty GeoJSON source and its fill layer; a file input in a corner slot hands the parsed file to `updateLayerData()`, with no MapLibre API. Rescored in U17; was X (FileReader upload UI) |
| view-local-geojson-experimental | H | the same hatch as View local GeoJSON with the File System Access picker (Chromium only; the browser suite can't drive it), so no page is planned. Rescored in U17; was X (File System Access API) |
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
| animate-an-icon-on-the-gpu | H | the YAML carries the point source and the symbol layer that names the icon; `addImage()` registers a `renderWithWebGL` style image after `mapReady()`. Needs maplibre-gl ≥ 6.3 (U19). The effects API doesn't fit, because effects enhance layers, not style images. Rescored in U17; was X (WebGL atlas writes) |
| display-a-remote-svg-symbol | E | `images:` loads the SVG through an `<img>` (U6) — re-badged in U16; was H (resolver callback) |
| elevate-symbols-above-the-terrain | H | `terrain:` landed (U15); `symbol-height-offset` only exists in maplibre-gl 6 — becomes E once 0.7 runs v6 (U19) |
| generate-and-add-a-missing-icon-to-the-map | H | `styleimagemissing` handler |
| use-a-fallback-image | H | `coalesce` image expression works, but icons must exist (images theme) |
| change-a-layers-color-with-buttons | H | `setPaintProperty` via `getMap()`; `state:` + `global-state` color is the declarative alternative (params-UI theme) |
| add-a-new-layer-below-labels | E | `before:` |
| add-a-custom-style-layer | H | `addLayer({type: 'custom'}, before)` after `mapReady()`, with `MercatorCoordinate` from `@maplibre-yaml/core/maplibre`. The effects API doesn't fit: an effect enhances an existing layer, and 0.7's only backend shades `fill-extrusion`. Rescored in U17; was X (custom WebGL layer) |
| add-a-pattern-to-a-polygon | H | `fill-pattern` needs the image in the sprite (images theme) |
| create-a-heatmap-layer | E | heatmap layer, raw expressions |
| create-and-style-clusters | E | `cluster:` + cluster layers; expansion-zoom click needs a JS line (note) |
| display-html-clusters-with-custom-properties | H | the clustered source with `clusterProperties` and the unclustered layers are YAML; the SVG donut markers are page JS (`Marker` from `@maplibre-yaml/core/maplibre`). Pure YAML would need source-bound markers with a registered renderer (ml-chh.16). Rescored in U17; was X (HTML markers) |
| visualize-population-density | E | `let`/`var` expression verbatim |
| measure-distances | H | the YAML declares the source and its layers; map clicks call `updateLayerData()`, and the distance readout sits in a corner slot. Rescored in U17; was X (interactive Turf tool) |
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
| filter-symbols-by-toggling-a-list | E | one labeled layer per type → params-panel checkbox each (`toggleable:`, U8) — re-badged in U16 |

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
| add-a-3d-model-using-threejs | **Ext** | a glTF model at a coordinate: the case for a models backend (ml-chh.19). Rescored in U17; was X (custom layer) |
| add-3d-tiles-using-threejs | X | OGC 3D Tiles streaming (3d-tiles-renderer with Draco/KTX2 transcoders), not a model at a coordinate. Kept X in the U17 rescore |
| add-a-3d-model-to-globe-using-threejs | X | the models backend on a globe; effects are mercator-only (ml-chh.19, ml-chh.20). Kept X in the U17 rescore |
| add-a-3d-model-with-babylonjs | **Ext** | the same model and placement as the three.js version; the engine doesn't matter to a backend (ml-chh.19). Rescored in U17; was X (custom layer) |
| add-a-3d-model-with-shadow-using-threejs | **Ext** | models backend with a shadow param (ml-chh.19). Rescored in U17; was X (custom layer) |
| adding-3d-models-using-threejs-on-terrain | **Ext** | models backend that is terrain-aware; today's effects declare absence under terrain (ml-chh.19). Rescored in U17; was X (custom layer) |
| extrude-polygons-for-3d-indoor-mapping | E | `fill-extrusion-height`/`-base` from properties |
| fill-extrusion-rounded-corners | E | v5 key rides passthrough (curated-key theme) |
| display-a-globe-with-a-vector-map | **G** | `projection:` absent (globe theme) |
| display-a-globe-with-an-atmosphere | **G** | globe + sky themes |
| add-a-custom-layer-with-tiles-to-a-globe | X | a tile-mesh renderer that reads `map.style.projection` internals. Kept X in the U17 rescore |
| add-a-simple-custom-layer-on-a-globe | H | the custom-layer hatch on `projection: globe` (YAML since U15), using MapLibre's public `projectTile` shader prelude; it repeats Add a custom style layer, so no page is planned. Rescored in U17; was X (custom layer) |
| create-a-heatmap-layer-on-a-globe-with-terrain-elevation | **G** | globe + terrain themes |
| display-a-globe-with-a-fill-extrusion-layer | **G** | globe theme |
| zoom-and-planet-size-relation-on-globe | H | `projection: globe` is YAML (U15); a slot button calls `flyTo` with the latitude zoom compensation, the fly-to hatch on a globe. Rescored in U17; was X (conceptual explainer) |

### Markers & popups

| example | v | how / what's missing |
|---|---|---|
| add-a-default-marker | **G** | no marker surface (theme anchor) |
| add-custom-icons-with-markers | **G** | markers theme |
| create-a-draggable-marker | H | `Marker({draggable: true})` from `@maplibre-yaml/core/maplibre` after `mapReady()`; pure YAML once markers gain `draggable:` and drag events (ml-chh.15). Rescored in U17; was X (drag interaction) |
| animate-a-marker | H | a rAF loop moves a `Marker` from `@maplibre-yaml/core/maplibre`; document markers have no handle yet (ml-chh.15). Rescored in U17; was X (rAF loop) |
| create-a-draggable-point | H | layer `mousedown`/`mousemove` after `mapReady()` call `updateLayerData()`; the coordinates readout sits in a corner slot. Rescored in U17; was X (drag events on layer) |
| display-a-popup | E | root `popups:` (popup at a coordinate, no layer/marker) — shipped in 0.7 U14; was G |
| display-a-popup-on-click | E | `interactive.click.popup` — flagship parity page |
| display-a-popup-on-hover | **G** | hover has only `highlight` (hover-popup theme; relates ml-fn9) |
| attach-a-popup-to-a-marker-instance | **G** | markers theme |

### Labels & internationalization

| example | v | how / what's missing |
|---|---|---|
| display-and-style-rich-text-labels | E | `format` expression in `text-field` |
| style-labels-with-web-fonts | H | `glyphs`/fonts via inline basemap object |
| style-labels-with-font-faces | H | inline basemap `font-faces` — validated by 5.x but only applied at runtime by maplibre-gl 6 (U19); no page yet |
| change-the-case-of-labels | E | `upcase`/`downcase` expressions |
| style-labels-with-local-fonts | H | font-stack override via inline basemap |
| variable-label-placement | E | `text-variable-anchor` (curated) |
| variable-label-placement-with-offset | E | `text-variable-anchor-offset` rides passthrough (curated-key theme) |
| change-a-maps-language | H | runtime `setLayoutProperty`; `global-state` `text-field` is the declarative alternative |
| locale-switching | E | `config.locale` (passed to the Map constructor) + `controls.fullscreen: {position: top-left}`; page pending (ml-chh.18). Rescored in U17; was X (page-UI localization) |
| use-locally-generated-ideographs | E | `config.localIdeographFontFamily` |

### Events & user interaction

| example | v | how / what's missing |
|---|---|---|
| get-features-under-the-mouse-pointer | H | `ml-map:layer-hover` DOM event or `queryRenderedFeatures` — good DOM-events showcase |
| create-a-hover-effect | E | `hover.highlight` (highlight color not authorable — note) |
| animate-symbol-to-follow-the-mouse | H | `projection: globe` + `controls.globe` are YAML; `mousemove` calls `updateLayerData()`. Rescored in U17; was X (rAF pointer tracking) |
| center-the-map-on-a-clicked-symbol | E | `click.zoomToFeature` / `click.flyTo` |
| display-performance-metrics | H | a corner-slot HUD fed by `ml-map:load` and the map's `idle`/`render` events after `mapReady()`. Rescored in U17; was X (perf instrumentation) |
| get-coordinates-of-the-mouse-pointer | H | `getMap()` mousemove |
| select-features-with-boxzoomend-callback | X | `boxZoomEnd` is a constructor-only callback that `<ml-map>` can't take (config is data; `boxZoom` validates as a boolean), and setting it after construction needs a private field. Kept X in the U17 rescore |
| show-polygon-information-on-click | E | `click.popup` with `property:` items |

### Plugins, protocols & integrations

| example | v | how / what's missing |
|---|---|---|
| geocode-with-nominatim | H | the geocoder plugin gets its `maplibregl` from `@maplibre-yaml/core/maplibre` and is added with `addControl()` after `mapReady()`. Rescored in U17; was X (geocoder plugin UI (no custom-control surface)) |
| pmtiles-source-and-protocol | H | protocol plugin before init — strongest candidate for a future `protocols:`/pmtiles surface |
| create-deckgl-layer-using-rest-api | H | deck's `MapboxOverlay` is a control, so `addControl()` after `mapReady()`. deck is host code here, not a library backend (D-A1). Rescored in U17; was X (deck.gl overlay) |
| draw-geometries-with-terra-draw | H | a plugin control added with `addControl()` after `mapReady()`. Rescored in U17; was X (draw plugin) |
| draw-polygon-with-mapbox-gl-draw | H | a plugin control added with `addControl()` after `mapReady()`; the area readout sits in a corner slot. Rescored in U17; was X (draw plugin) |
| sync-movement-of-multiple-maps | H | three `<ml-map>` elements; await each `mapReady()`, then `syncMaps()`. Rescored in U17; was X (multi-map sync plugin) |
| toggle-deckgl-layer | H | the deck hatch plus a show/hide button; it repeats Create deck.gl layer, so no page is planned. Rescored in U17; was X (deck.gl) |
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

## U16 escape-hatch pages (2026-10-05)

0.7 U16 (ml-vw4.6) built pages for the badge-only H rows: 22 new hatch
pages (YAML + page JS + slot chrome, each with a hermetic twin driven by
`examples/gallery/hatch/twin.html` and a behaviour test in
`e2e/gallery-hatch-u16.spec.ts`), and re-badged 4 rows to E (above). The
Wave 3 pages' controls moved into `<ml-map>` corner slots (ml-7fb).
Still badge-only: add-a-cog-raster-source (needs a hermetic COG fixture
plus the cog-protocol plugin), add-3d-terrain-from-quantized-mesh-tiles
(pre-release plugin from a CDN `src/`, no hermetic quantized-mesh
fixture), elevate-symbols-above-the-terrain and style-labels-with-font-faces
(both need the maplibre-gl 6 runtime, U19).

## U17 rescore (2026-10-05, ml-vw4.7)

0.7 Amendment A1 track (d) asked for this rescore. Every X row was rescored
against what 0.7 ships:
- `mapReady()`, the `@maplibre-yaml/core/maplibre` module (the exact
  maplibre-gl core uses), and `updateLayerData()`;
- `<ml-map>` corner slots for page chrome;
- markers (U5), images (U6), popups (U7) and the params panel (U8);
- `fitTo` and `color-relief` (U14), and `terrain:`/`sky:`/`projection:` (U15);
- maplibre-gl 6 (U19, PR #131; rows that depend on it are marked);
- the experimental effects API, `registerEffect()`. Its backend is route 2,
  a MapLibre custom layer. deck.gl is not a library backend (D-A1).

Each verdict comes from reading the upstream example's code
(`maplibre/maplibre-gl-js` `test/examples/<slug>.html`). Rows that move gain
a badge and stay badge-only: none of them has a page yet.

**Census, before → after (139 upstream rows):**

| Verdict | Before (after U16) | After U17 |
|---|---|---|
| E — Pure YAML | 73 (70 pages, 3 badge only) | **74** (70 pages, 4 badge only) |
| H — Escape hatch | 32 (28 pages, 4 badge only) | **55** (28 pages, 27 badge only) |
| G — Gap | 0 | 0 |
| Ext — Extension (new) | — | **4** |
| X — JS territory | 34 | **6** |

**Moves (28 of 34):**

| example | from → to | why |
|---|---|---|
| locale-switching | X → E | `config.locale` is a schema key passed to the Map constructor; `controls.fullscreen: {position: top-left}` |
| check-if-webgl-is-supported | X → H | the element already shows its error card and fires `ml-map:error` when map construction fails; the typed check needs ml-chh.17 |
| customize-the-map-transform-constrain | X → H | `setTransformConstrain()` after `mapReady()` (maplibre-gl ≥ 5.10) |
| level-of-detail-control | X → H | params-panel sliders → `ml-map:parameter-change` → `setSourceTileLodParams()` |
| navigate-the-map-with-game-like-controls | X → H | discrete keydown → `panBy`/`easeTo`; the fly-to hatch, not a game loop |
| view-local-geojson | X → H | file input in a slot → `updateLayerData()` |
| view-local-geojson-experimental | X → H | same hatch; Chromium-only picker; no page planned |
| animate-an-icon-on-the-gpu | X → H | `addImage()` with a `renderWithWebGL` style image (maplibre-gl ≥ 6.3); not an effect |
| add-a-custom-style-layer | X → H | `addLayer({type: 'custom'}, before)` + module `MercatorCoordinate`; not an effect |
| display-html-clusters-with-custom-properties | X → H | source and layers are YAML; donut markers are page JS (pure YAML: ml-chh.16) |
| measure-distances | X → H | map click → `updateLayerData()`; readout in a slot |
| add-a-simple-custom-layer-on-a-globe | X → H | custom-layer hatch on `projection: globe` via the public `projectTile` prelude; no page planned |
| zoom-and-planet-size-relation-on-globe | X → H | `projection: globe` + a slot button calling `flyTo` |
| create-a-draggable-marker | X → H | module `Marker({draggable})` (pure YAML: ml-chh.15) |
| animate-a-marker | X → H | rAF + module `Marker` (document-marker handle: ml-chh.15) |
| create-a-draggable-point | X → H | layer mouse events → `updateLayerData()` |
| animate-symbol-to-follow-the-mouse | X → H | `projection: globe` + `controls.globe`; mousemove → `updateLayerData()` |
| display-performance-metrics | X → H | slot HUD fed by the map's `idle`/`render` events |
| geocode-with-nominatim | X → H | the plugin takes its `maplibregl` from the core module |
| create-deckgl-layer-using-rest-api | X → H | deck `MapboxOverlay` as a control (host code, not a backend) |
| toggle-deckgl-layer | X → H | the deck hatch + a toggle; no page planned |
| draw-geometries-with-terra-draw | X → H | plugin control via `addControl()` |
| draw-polygon-with-mapbox-gl-draw | X → H | plugin control via `addControl()` |
| sync-movement-of-multiple-maps | X → H | three elements, each awaited with `mapReady()`, then `syncMaps()` |
| add-a-3d-model-using-threejs | X → Ext | models backend (ml-chh.19) |
| add-a-3d-model-with-babylonjs | X → Ext | models backend (ml-chh.19) |
| add-a-3d-model-with-shadow-using-threejs | X → Ext | models backend with a shadow param (ml-chh.19) |
| adding-3d-models-using-threejs-on-terrain | X → Ext | terrain-aware models backend (ml-chh.19) |

**Kept X (6):** enter-a-360-photosphere, walk-around-a-map-in-first-person,
add-3d-tiles-using-threejs, add-a-3d-model-to-globe-using-threejs (needs
ml-chh.19 + ml-chh.20), add-a-custom-layer-with-tiles-to-a-globe, and
select-features-with-boxzoomend-callback. Reasons are in the table above.

**Where this departs from the maintainer's desk rescore** (each checked against
the upstream code):
- **Custom style layer and GPU icon are H, not effects.** An effect *enhances an
  existing layer*, and 0.7's only backend shades `fill-extrusion` faces. No
  backend draws free geometry or a style image, and the plain custom-layer and
  `addImage` hatches already reach both.
- **add-3d-tiles-using-threejs stays X.** It is OGC 3D Tiles streaming, not a
  glTF at a coordinate, so a models backend wouldn't cover it.
- **Draggable marker and HTML clusters are badged H, with beads for the YAML
  route.** Both are reachable by a hatch today, which is the badge the census
  reports. The draggable marker is a small addition (ml-chh.15). HTML
  clusters is not small: the donut is computed SVG, so it needs source-bound
  markers plus a registered renderer (ml-chh.16).
- **locale-switching is E, not H.** `config.locale` already exists.
- **Five desk "still out" rows are reachable by a short hatch:**
  check-if-webgl, transform-constrain, level-of-detail, game-like controls,
  performance metrics. The zoom-and-planet-size explainer is a sixth, since
  `projection:` is now YAML.
- **View-local-geojson-experimental and toggle-deckgl-layer are H, but no page
  is planned.** Each is the same hatch as a sibling row. The desk had them
  out.
- **add-a-simple-custom-layer-on-a-globe is H, but no page is planned.** The
  raw custom-layer hatch works on globe through MapLibre's public projection
  prelude. Only the *effects* route is globe-blocked.
- **select-features-with-boxzoomend-callback stays X.** The desk had it as H.
  `boxZoomEnd` is a constructor-only callback. `<ml-map>` config is data, and
  its `boxZoom` key validates as a boolean.

**Beads filed** (all under ml-chh, unlabeled for triage):
- ml-chh.15: markers `draggable:` + drag events + id handle
- ml-chh.16: source-bound markers with a registered renderer
- ml-chh.17: `ml-map:error` carries the original construction Error
- ml-chh.18: pages for the U17 rows (20 hatch pages + locale-switching)
- ml-chh.19: effects models backend (glTF at a coordinate)
- ml-chh.20: globe-capable effects backends

Existing beads these rows lean on: ml-rww (the 85° pitch cap) and U19 /
ml-vw4.9 (maplibre-gl 6).
