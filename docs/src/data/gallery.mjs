/**
 * The gallery's one list: every MapLibre GL JS example and the pages this
 * site has for them, by group.
 *
 * Two things read it, so they cannot disagree:
 *  - the gallery index (`examples/gallery/index.mdx`), through
 *    `GalleryGroup.astro`, which draws each group's table;
 *  - every gallery page, through the Starlight `PageTitle` and
 *    `MarkdownContent` overrides (`src/components/overrides/`), which add the
 *    link back to the index and the "Use this map" footer with the group's
 *    guide and reference links.
 *
 * An entry with `slug` has a page at /examples/gallery/<slug>/. An entry with
 * `upstream` (the example's name on maplibre.org) has no page here; its note
 * says what an author would write instead. `docs/test/gallery-data.test.mjs`
 * checks that every page has exactly one entry and every link target exists.
 *
 * Notes are one line of reader-facing text: `code` and [links](/path/) only.
 */

/** What the author writes for an example, in the order the index explains them. */
export const KINDS = {
  yaml: {
    label: "YAML",
    variant: "success",
  },
  "yaml-js": {
    label: "YAML + JavaScript",
    variant: "caution",
  },
  js: {
    label: "JavaScript",
    variant: "default",
  },
};

export const UPSTREAM = "https://maplibre.org/maplibre-gl-js/docs/examples/";

const FIRST_MAP = { label: "Your first map, explained", href: "/getting-started/first-map/" };
const DATA = { label: "Loading data", href: "/guides/data-sources/" };
const LARGE = { label: "Large data", href: "/guides/cloud-native-data/" };
const PMTILES = { label: "PMTiles", href: "/guides/pmtiles/" };
const FLATGEOBUF = { label: "FlatGeobuf", href: "/guides/flatgeobuf/" };
const GEOPARQUET = { label: "GeoParquet", href: "/guides/geoparquet/" };
const COG = { label: "Cloud Optimized GeoTIFF (COG)", href: "/guides/cog/" };
const LIVE = { label: "Live data & streaming", href: "/guides/live-data/" };
const LAYERS = { label: "Layers & styling", href: "/guides/layers/" };
const THEMATIC = { label: "Thematic maps & legends", href: "/guides/thematic-maps/" };
const POPUPS = { label: "Popups, hover & controls", href: "/guides/popups/" };
const LANGUAGES = { label: "Accessibility & languages", href: "/guides/accessibility-languages/" };
const MAP_CONFIG = { label: "Map configuration", href: "/schema/map-config/" };
const JS_API = { label: "JavaScript API", href: "/integrations/vanilla-js/" };
const EFFECTS = { label: "Effects (experimental)", href: "/guides/effects/" };
const STORY_HTML = { label: "Story maps in plain HTML", href: "/integrations/scrollytelling-html/" };
const STORY_ASTRO = { label: "Story maps in Astro", href: "/integrations/astro-stories/" };

const REF_CONFIG = { label: "`config:`", href: "/reference/yaml/map/#config" };
const REF_CONTROLS = { label: "`controls:`", href: "/reference/yaml/map/#controls" };
const REF_SOURCES = { label: "Sources", href: "/reference/yaml/sources/" };
const REF_LAYERS = { label: "Layers", href: "/reference/yaml/layers/" };
const REF_INTERACTIVE = { label: "`interactive:`", href: "/reference/yaml/layers/#interactive" };
const REF_ELEMENT = { label: "`<ml-map>` methods, events and slots", href: "/reference/elements/" };

/**
 * The groups, in index order. `id` is the anchor of the group's heading on
 * the index (the heading text, slugged), so `/examples/gallery/#<id>` lands
 * on it. `guides` and `reference` are the default links every page in the
 * group shows; an entry's own `guides` / `reference` / `see` add to them.
 */
export const GROUPS = [
  {
    id: "map-basics",
    title: "Map basics",
    guides: [FIRST_MAP],
    reference: [REF_CONFIG],
    entries: [
      { slug: "display-a-map", title: "Display a map", kind: "yaml" },
      { slug: "display-a-satellite-map", title: "Display a satellite map", kind: "yaml" },
      { slug: "display-a-non-interactive-map", title: "Display a non-interactive map", kind: "yaml" },
      { slug: "change-the-default-position-for-attribution", title: "Change the default position for attribution", kind: "yaml" },
      { upstream: "check-if-webgl-is-supported", title: "Check if WebGL is supported", kind: "yaml-js", note: "`<ml-map>` already shows an error card when the map can't start, and fires `ml-map:error`; a listener for it replaces the upstream `alert`. The event doesn't say whether missing WebGL was the cause." },
      { slug: "display-a-map-with-mlt", title: "Display a map with MLT", kind: "yaml" },
    ],
  },
  {
    id: "camera--animation",
    title: "Camera & animation",
    guides: [FIRST_MAP],
    reference: [REF_CONFIG],
    entries: [
      { slug: "fly-to-a-location", title: "Fly to a location", kind: "yaml-js" },
      { slug: "jump-to-a-series-of-locations", title: "Jump to a series of locations", kind: "yaml-js" },
      { slug: "set-pitch-and-bearing", title: "Set pitch and bearing", kind: "yaml" },
      { slug: "slowly-fly-to-a-location", title: "Slowly fly to a location", kind: "yaml-js" },
      { slug: "animate-a-line", title: "Animate a line", kind: "yaml-js" },
      { slug: "animate-a-point", title: "Animate a point", kind: "yaml-js" },
      { slug: "animate-a-point-along-a-route", title: "Animate a point along a route", kind: "yaml-js" },
      { slug: "animate-map-camera-around-a-point", title: "Animate map camera around a point", kind: "yaml-js" },
      { slug: "customize-camera-animations", title: "Customize camera animations", kind: "yaml-js" },
      { upstream: "customize-the-map-transform-constrain", title: "Customize the map transform constrain", kind: "yaml-js", note: "The constrain function is page code: call `setTransformConstrain()` on the map from `mapReady()` (maplibre-gl 5.10 or later). The zoom below 0 is set from the same code, because a document's zoom starts at 0." },
      { upstream: "enter-a-360-photosphere", title: "Enter a 360° photosphere", kind: "js", note: "A photosphere plugin, and a pitch of 175°; a document's pitch stops at 85°." },
      { slug: "fit-a-map-to-a-bounding-box", title: "Fit a map to a bounding box", kind: "yaml" },
      { slug: "fit-to-the-bounds-of-a-linestring", title: "Fit to the bounds of a LineString", kind: "yaml" },
      { slug: "fly-to-a-location-based-on-scroll-position", title: "Fly to a location based on scroll position", kind: "yaml", note: "A story map: a `type: scrollytelling` document.", story: true, guides: [STORY_HTML, STORY_ASTRO], reference: [{ label: "Story file", href: "/reference/yaml/scrollytelling/" }] },
      { slug: "hash-routing", title: "Hash routing", kind: "yaml" },
      { upstream: "level-of-detail-control", title: "Level of detail control", kind: "yaml-js", note: "Sliders from `parameters:` fire `ml-map:parameter-change`; its listener makes one `setSourceTileLodParams()` call." },
      { slug: "offset-the-vanishing-point-using-padding", title: "Offset the vanishing point using padding", kind: "yaml-js" },
      { slug: "render-world-copies", title: "Render world copies", kind: "yaml" },
      { slug: "restrict-map-panning-to-an-area", title: "Restrict map panning to an area", kind: "yaml" },
      { slug: "set-center-point-above-ground", title: "Set center point above ground", kind: "yaml" },
      { upstream: "walk-around-a-map-in-first-person", title: "Walk around a map in first person", kind: "js", note: "A game loop that moves the camera every frame, at a pitch of 90°; a document's pitch stops at 85°." },
    ],
  },
  {
    id: "controls--gestures",
    title: "Controls & gestures",
    guides: [POPUPS],
    reference: [REF_CONTROLS, REF_CONFIG],
    entries: [
      { slug: "display-map-navigation-controls", title: "Display map navigation controls", kind: "yaml" },
      { slug: "locate-the-user", title: "Locate the user", kind: "yaml" },
      { slug: "cooperative-gestures", title: "Cooperative gestures", kind: "yaml" },
      { slug: "disable-map-rotation", title: "Disable map rotation", kind: "yaml" },
      { slug: "disable-scroll-zoom", title: "Disable scroll zoom", kind: "yaml" },
      { upstream: "navigate-the-map-with-game-like-controls", title: "Navigate the map with game-like controls", kind: "yaml-js", note: "`interactive: false` is YAML; the arrow keys call `panBy` and `easeTo` from `mapReady()`, the same camera code as Fly to a location." },
      { slug: "toggle-interactions", title: "Toggle interactions", kind: "yaml-js" },
      { slug: "view-a-fullscreen-map", title: "View a fullscreen map", kind: "yaml" },
    ],
  },
  {
    id: "sources--data",
    title: "Sources & data",
    guides: [DATA],
    reference: [REF_SOURCES],
    entries: [
      { slug: "add-a-vector-tile-source", title: "Add a vector tile source", kind: "yaml" },
      { slug: "add-a-geojson-line", title: "Add a GeoJSON line", kind: "yaml" },
      { slug: "add-a-geojson-polygon", title: "Add a GeoJSON polygon", kind: "yaml" },
      { slug: "draw-geojson-points", title: "Draw GeoJSON points", kind: "yaml" },
      { slug: "add-multiple-geometries-from-one-geojson-source", title: "Add multiple geometries from one GeoJSON source", kind: "yaml" },
      { slug: "display-line-that-crosses-180th-meridian", title: "Display line that crosses 180th meridian", kind: "yaml" },
      { upstream: "view-local-geojson", title: "View local GeoJSON", kind: "yaml-js", note: "The YAML declares an empty GeoJSON source and its fill layer; a file input in a corner slot hands the file it reads to `updateLayerData()`." },
      { upstream: "view-local-geojson-experimental", title: "View local GeoJSON (experimental)", kind: "yaml-js", note: "The same page code as View local GeoJSON, with the browser's file system picker (Chromium only)." },
      { slug: "add-a-raster-tile-source", title: "Add a raster tile source", kind: "yaml" },
      { slug: "add-a-wms-source", title: "Add a WMS source", kind: "yaml" },
      { slug: "add-a-canvas-source", title: "Add a canvas source", kind: "yaml-js" },
      { slug: "add-a-cog-raster-source", title: "Add a COG raster source", kind: "yaml", note: "Imagery, hillshade and 3D terrain from Cloud Optimized GeoTIFFs.", guides: [COG] },
      { slug: "add-a-video", title: "Add a video", kind: "yaml" },
      { slug: "animate-a-series-of-images", title: "Animate a series of images", kind: "yaml-js" },
      { slug: "add-live-realtime-data", title: "Add live realtime data", kind: "yaml", guides: [LIVE], see: [{ label: "Earthquake tracker", href: "/examples/earthquake-tracker/" }] },
      { slug: "update-a-feature-in-realtime", title: "Update a feature in realtime", kind: "yaml", guides: [LIVE], see: [{ label: "Merge updates by id", href: "/guides/live-data/#merge" }] },
      { slug: "update-geojson-polygons", title: "Update GeoJSON polygons", kind: "yaml-js" },
    ],
  },
  {
    id: "layers-icons--styling",
    title: "Layers, icons & styling",
    guides: [LAYERS],
    reference: [REF_LAYERS],
    entries: [
      { slug: "add-an-icon-to-the-map", title: "Add an icon to the map", kind: "yaml" },
      { slug: "add-a-generated-icon-to-the-map", title: "Add a generated icon to the map", kind: "yaml-js" },
      { slug: "add-a-stretchable-image-to-the-map", title: "Add a stretchable image to the map", kind: "yaml-js" },
      { slug: "add-an-animated-icon-to-the-map", title: "Add an animated icon to the map", kind: "yaml-js" },
      { upstream: "animate-an-icon-on-the-gpu", title: "Animate an icon on the GPU", kind: "yaml-js", note: "The YAML holds the point source and the symbol layer that names the icon; `addImage()` registers the WebGL-drawn icon from `mapReady()` (maplibre-gl 6.3 or later)." },
      { slug: "display-a-remote-svg-symbol", title: "Display a remote SVG symbol", kind: "yaml" },
      { slug: "elevate-symbols-above-the-terrain", title: "Elevate symbols above the terrain", kind: "yaml", note: "`symbol-height-offset` (maplibre-gl 6.6 or later)." },
      { slug: "generate-and-add-a-missing-icon-to-the-map", title: "Generate and add a missing icon to the map", kind: "yaml-js" },
      { slug: "use-a-fallback-image", title: "Use a fallback image", kind: "yaml" },
      { slug: "change-a-layers-color-with-buttons", title: "Change a layer's color with buttons", kind: "yaml" },
      { slug: "add-a-new-layer-below-labels", title: "Add a new layer below labels", kind: "yaml" },
      { upstream: "add-a-custom-style-layer", title: "Add a custom style layer", kind: "yaml-js", note: "`addLayer({ type: 'custom' })` from `mapReady()`, with `MercatorCoordinate` imported from `@maplibre-yaml/core/maplibre`." },
      { slug: "add-a-pattern-to-a-polygon", title: "Add a pattern to a polygon", kind: "yaml" },
      { slug: "create-a-heatmap-layer", title: "Create a heatmap layer", kind: "yaml" },
      { slug: "create-and-style-clusters", title: "Create and style clusters", kind: "yaml", note: "Clustered points with counts; click a cluster to zoom in.", guides: [DATA] },
      { upstream: "display-html-clusters-with-custom-properties", title: "Display HTML clusters with custom properties", kind: "yaml-js", note: "The clustered source, its `clusterProperties` and the unclustered layers are YAML; the SVG donut markers are page code, using `Marker` from `@maplibre-yaml/core/maplibre`." },
      { slug: "display-and-style-rich-text-labels", title: "Display and style rich text labels", kind: "yaml" },
      { slug: "style-labels-with-web-fonts", title: "Style labels with web fonts", kind: "yaml" },
      { slug: "style-labels-with-font-faces", title: "Style labels with font faces", kind: "yaml", note: "`font-faces` in an inline `mapStyle` (maplibre-gl 6.7 or later)." },
      { slug: "change-the-case-of-labels", title: "Change the case of labels", kind: "yaml" },
      { slug: "style-labels-with-local-fonts", title: "Style labels with local fonts", kind: "yaml" },
      { slug: "variable-label-placement", title: "Variable label placement", kind: "yaml" },
      { slug: "variable-label-placement-with-offset", title: "Variable label placement with offset", kind: "yaml" },
    ],
  },
  {
    id: "expressions--data-driven-styling",
    title: "Expressions & data-driven styling",
    guides: [LAYERS, THEMATIC],
    reference: [REF_LAYERS],
    entries: [
      { slug: "style-lines-with-a-data-driven-property", title: "Style lines with a data-driven property", kind: "yaml" },
      { slug: "change-building-color-based-on-zoom-level", title: "Change building color based on zoom level", kind: "yaml" },
      { slug: "create-a-gradient-dashed-line-using-an-expression", title: "Create a gradient dashed line using an expression", kind: "yaml" },
      { slug: "create-a-gradient-line-using-an-expression", title: "Create a gradient line using an expression", kind: "yaml" },
      { slug: "filter-within-a-layer", title: "Filter within a layer", kind: "yaml-js" },
      { slug: "filter-symbols-by-text-input", title: "Filter symbols by text input", kind: "yaml-js" },
      { slug: "filter-layer-symbols-using-global-state", title: "Filter layer symbols using global state", kind: "yaml", reference: [{ label: "`state:`", href: "/reference/yaml/map/#state" }] },
      { slug: "filter-symbols-by-toggling-a-list", title: "Filter symbols by toggling a list", kind: "yaml" },
      { slug: "visualize-population-density", title: "Visualize population density", kind: "yaml" },
      { slug: "create-a-time-slider", title: "Create a time slider", kind: "yaml", reference: [{ label: "`parameters:`", href: "/reference/yaml/map/#parameters" }] },
      { upstream: "measure-distances", title: "Measure distances", kind: "yaml-js", note: "The YAML declares the source and its layers; map clicks call `updateLayerData()`, and the distance shows in a corner slot." },
      { slug: "draw-a-circle", title: "Draw a circle", kind: "yaml-js" },
    ],
  },
  {
    id: "terrain-3d--globe",
    title: "Terrain, 3D & globe",
    guides: [MAP_CONFIG],
    reference: [
      { label: "`terrain:`", href: "/reference/yaml/map/#terrain" },
      { label: "`sky:`", href: "/reference/yaml/map/#sky" },
      { label: "`projection:`", href: "/reference/yaml/map/#projection" },
    ],
    entries: [
      { slug: "3d-terrain", title: "3D terrain", kind: "yaml" },
      { slug: "add-a-hillshade-layer", title: "Add a hillshade layer", kind: "yaml" },
      { upstream: "add-3d-terrain-from-quantized-mesh-tiles", title: "Add 3D terrain from quantized mesh tiles", kind: "yaml-js", note: "Reads the mesh tiles through a third-party plugin set up in page code." },
      { slug: "add-a-color-relief-layer", title: "Add a color relief layer", kind: "yaml" },
      { slug: "add-a-multidirectional-hillshade-layer", title: "Add a multidirectional hillshade layer", kind: "yaml", note: "maplibre-gl 5.5 or later." },
      { slug: "add-contour-lines", title: "Add contour lines", kind: "yaml-js" },
      { slug: "display-a-hybrid-satellite-map-with-terrain-elevation", title: "Display a hybrid satellite map with terrain elevation", kind: "yaml" },
      { slug: "sky-fog-terrain", title: "Sky, fog and terrain", kind: "yaml" },
      { slug: "display-buildings-in-3d", title: "Display buildings in 3D", kind: "yaml" },
      { upstream: "add-a-3d-model-using-threejs", title: "Add a 3D model using three.js", kind: "yaml-js", note: "A three.js custom layer, added with `addLayer()` from `mapReady()` as in Add a custom style layer." },
      { upstream: "add-3d-tiles-using-threejs", title: "Add 3D tiles using three.js", kind: "js", note: "Streams OGC 3D Tiles with a dedicated renderer and its decoders." },
      { upstream: "add-a-3d-model-to-globe-using-threejs", title: "Add a 3D model to globe using three.js", kind: "js", note: "A three.js model placed with the globe projection's own matrices." },
      { upstream: "add-a-3d-model-with-babylonjs", title: "Add a 3D model with babylon.js", kind: "yaml-js", note: "A babylon.js custom layer, added with `addLayer()` from `mapReady()` as in Add a custom style layer." },
      { upstream: "add-a-3d-model-with-shadow-using-threejs", title: "Add a 3D model with shadow using three.js", kind: "yaml-js", note: "A three.js custom layer with a shadow, added with `addLayer()` from `mapReady()`." },
      { upstream: "adding-3d-models-using-threejs-on-terrain", title: "Adding 3D models using three.js on terrain", kind: "yaml-js", note: "A three.js custom layer over `terrain:`, added with `addLayer()` from `mapReady()`." },
      { slug: "extrude-polygons-for-3d-indoor-mapping", title: "Extrude polygons for 3D indoor mapping", kind: "yaml" },
      { slug: "fill-extrusion-rounded-corners", title: "Fill-extrusion rounded corners", kind: "yaml", note: "Height and opacity sliders from `parameters:` (maplibre-gl 6.2 or later)." },
      { slug: "display-a-globe-with-a-vector-map", title: "Display a globe with a vector map", kind: "yaml" },
      { slug: "display-a-globe-with-an-atmosphere", title: "Display a globe with an atmosphere", kind: "yaml" },
      { upstream: "add-a-custom-layer-with-tiles-to-a-globe", title: "Add a custom layer with tiles to a globe", kind: "js", note: "A tile renderer that reads MapLibre's internal projection state." },
      { upstream: "add-a-simple-custom-layer-on-a-globe", title: "Add a simple custom layer on a globe", kind: "yaml-js", note: "The Add a custom style layer code on a `projection: globe` map." },
      { slug: "create-a-heatmap-layer-on-a-globe-with-terrain-elevation", title: "Create a heatmap layer on a globe with terrain elevation", kind: "yaml" },
      { slug: "display-a-globe-with-a-fill-extrusion-layer", title: "Display a globe with a fill extrusion layer", kind: "yaml" },
      { upstream: "zoom-and-planet-size-relation-on-globe", title: "Zoom and planet size relation on globe", kind: "yaml-js", note: "`projection: globe` is YAML; a button in a corner slot calls `flyTo` with the zoom adjusted for latitude." },
    ],
  },
  {
    id: "markers--popups",
    title: "Markers & popups",
    guides: [POPUPS],
    reference: [{ label: "`markers:`", href: "/reference/yaml/map/#markers" }, REF_INTERACTIVE],
    entries: [
      { slug: "add-a-default-marker", title: "Add a default marker", kind: "yaml" },
      { slug: "add-custom-icons-with-markers", title: "Add custom icons with markers", kind: "yaml" },
      { upstream: "create-a-draggable-marker", title: "Create a draggable marker", kind: "yaml-js", note: "`new Marker({ draggable: true })`, with `Marker` from `@maplibre-yaml/core/maplibre`, added from `mapReady()`." },
      { upstream: "animate-a-marker", title: "Animate a marker", kind: "yaml-js", note: "An animation loop moves a `Marker` from `@maplibre-yaml/core/maplibre`; markers declared in YAML can't be moved from code." },
      { upstream: "create-a-draggable-point", title: "Create a draggable point", kind: "yaml-js", note: "Layer `mousedown` and `mousemove` handlers, added from `mapReady()`, call `updateLayerData()`; the coordinates show in a corner slot." },
      { slug: "display-a-popup", title: "Display a popup", kind: "yaml" },
      { slug: "display-a-popup-on-click", title: "Display a popup on click", kind: "yaml" },
      { slug: "display-a-popup-on-hover", title: "Display a popup on hover", kind: "yaml" },
      { slug: "attach-a-popup-to-a-marker-instance", title: "Attach a popup to a marker instance", kind: "yaml" },
    ],
  },
  {
    id: "internationalization",
    title: "Internationalization",
    guides: [LANGUAGES],
    reference: [{ label: "`config.locale`", href: "/reference/yaml/map/#config-locale" }],
    entries: [
      { slug: "change-a-maps-language", title: "Change a map's language", kind: "yaml-js" },
      { upstream: "locale-switching", title: "Locale switching", kind: "yaml", note: "`config.locale` sets the controls' text, and `controls.fullscreen` takes a `position`." },
      { slug: "use-locally-generated-ideographs", title: "Use locally generated ideographs", kind: "yaml" },
    ],
  },
  {
    id: "events--user-interaction",
    title: "Events & user interaction",
    guides: [POPUPS],
    reference: [REF_INTERACTIVE],
    entries: [
      { slug: "get-features-under-the-mouse-pointer", title: "Get features under the mouse pointer", kind: "yaml-js" },
      { slug: "create-a-hover-effect", title: "Create a hover effect", kind: "yaml" },
      { upstream: "animate-symbol-to-follow-the-mouse", title: "Animate symbol to follow the mouse", kind: "yaml-js", note: "`projection: globe` and `controls.globe` are YAML; a `mousemove` handler calls `updateLayerData()`." },
      { slug: "center-the-map-on-a-clicked-symbol", title: "Center the map on a clicked symbol", kind: "yaml" },
      { upstream: "display-performance-metrics", title: "Display performance metrics", kind: "yaml-js", note: "A panel in a corner slot, updated from `ml-map:load` and the map's `idle` and `render` events." },
      { slug: "get-coordinates-of-the-mouse-pointer", title: "Get coordinates of the mouse pointer", kind: "yaml-js" },
      { upstream: "select-features-with-boxzoomend-callback", title: "Select features with boxzoomend callback", kind: "js", note: "`boxZoomEnd` is a callback MapLibre takes only when the map is created, and a document holds data, not functions." },
      { slug: "show-polygon-information-on-click", title: "Show polygon information on click", kind: "yaml" },
    ],
  },
  {
    id: "plugins-protocols--integrations",
    title: "Plugins, protocols & integrations",
    guides: [JS_API],
    reference: [REF_ELEMENT],
    entries: [
      { upstream: "geocode-with-nominatim", title: "Geocode with Nominatim", kind: "yaml-js", note: "The geocoder takes its `maplibregl` from `@maplibre-yaml/core/maplibre` and is added with `addControl()` from `mapReady()`." },
      { slug: "pmtiles-source-and-protocol", title: "PMTiles source and protocol", kind: "yaml", note: "A `.pmtiles` file or `pmtiles://` URL, with no page JavaScript.", guides: [PMTILES], reference: [REF_SOURCES] },
      { upstream: "create-deckgl-layer-using-rest-api", title: "Create deck.gl layer using REST API", kind: "yaml-js", note: "deck.gl's `MapboxOverlay` is a control: add it with `addControl()` from `mapReady()`." },
      { upstream: "draw-geometries-with-terra-draw", title: "Draw geometries with Terra Draw", kind: "yaml-js", note: "A plugin control added with `addControl()` from `mapReady()`." },
      { upstream: "draw-polygon-with-mapbox-gl-draw", title: "Draw polygon with mapbox-gl-draw", kind: "yaml-js", note: "A plugin control added with `addControl()` from `mapReady()`; the area shows in a corner slot." },
      { upstream: "sync-movement-of-multiple-maps", title: "Sync movement of multiple maps", kind: "yaml-js", note: "Three `<ml-map>` elements; wait for each one's `mapReady()`, then hand the maps to the sync plugin." },
      { upstream: "toggle-deckgl-layer", title: "Toggle deck.gl layer", kind: "yaml-js", note: "The Create deck.gl layer code plus a show/hide button." },
      { slug: "use-addprotocol-to-transform-feature-properties", title: "Use addProtocol to transform feature properties", kind: "yaml-js" },
    ],
  },
  {
    id: "cloud-native-data",
    title: "Cloud-native data",
    upstreamGroup: false,
    guides: [LARGE],
    reference: [REF_SOURCES],
    entries: [
      { slug: "flatgeobuf-source", title: "FlatGeobuf source", kind: "yaml", note: "A `.fgb` file as a GeoJSON source, with popups, a legend and `fitTo`.", guides: [FLATGEOBUF] },
      { slug: "geoparquet-source", title: "GeoParquet source", kind: "yaml", note: "A `.parquet` file as a GeoJSON source, with `classify:`, popups, `fitTo` and reading by view.", guides: [GEOPARQUET] },
    ],
  },
  {
    id: "mapzen-classics",
    title: "Mapzen classics",
    upstreamGroup: false,
    guides: [{ label: "Mapzen classics", href: "/examples/classics/" }, EFFECTS],
    reference: [REF_LAYERS],
    entries: [
      { slug: "crosshatch", title: "Crosshatch", kind: "yaml", note: "After Tangram's [crosshatch](https://github.com/tangrams/tangram-sandbox/blob/gh-pages/styles/crosshatch.yaml) style." },
      { slug: "blueprint", title: "Blueprint", kind: "yaml", note: "A blueprint look in plain style properties." },
    ],
  },
];

/** The five pages to open first, in reading order, with why. */
export const START_HERE = [
  { slug: "display-a-map", why: "The smallest map document: a center, a zoom and a basemap." },
  { slug: "draw-geojson-points", why: "A list of points written in the document, drawn as circles." },
  { slug: "display-a-popup-on-click", why: "A popup with a feature's properties, written in YAML." },
  { slug: "create-and-style-clusters", why: "Thousands of points grouped into counted clusters." },
  { slug: "add-live-realtime-data", why: "A layer that polls a live feed on an interval." },
];

/** Every entry with its group, in index order. */
export function allEntries() {
  return GROUPS.flatMap((group) => group.entries.map((entry) => ({ ...entry, group })));
}

/** The entry for a gallery page's slug, with its group, or undefined. */
export function entryForSlug(slug) {
  return allEntries().find((e) => e.slug === slug);
}

/** The MapLibre example an entry replicates, or null for this site's own groups. */
export function upstreamUrl(entry) {
  if (entry.group?.upstreamGroup === false) return null;
  return `${UPSTREAM}${entry.slug ?? entry.upstream}/`;
}

/** Counts for the index's summary line, computed so they cannot go stale. */
export function census() {
  const upstream = allEntries().filter((e) => e.group.upstreamGroup !== false);
  const pages = allEntries().filter((e) => e.slug);
  const byKind = (list, kind) => list.filter((e) => e.kind === kind).length;
  const upstreamPages = upstream.filter((e) => e.slug);
  return {
    upstreamTotal: upstream.length,
    upstreamWithPages: upstreamPages.length,
    upstreamPagesYaml: byKind(upstreamPages, "yaml"),
    upstreamPagesYamlJs: byKind(upstreamPages, "yaml-js"),
    ownPages: pages.length - upstreamPages.length,
    pages: pages.length,
  };
}

/**
 * The guide, reference and "see also" links for one entry: its group's
 * defaults, then its own, without repeats. YAML + JavaScript pages also get
 * the element reference, where `mapReady()`, the events and the slots live.
 */
export function linksFor(entry) {
  const dedupe = (list) => {
    const seen = new Set();
    return list.filter((l) => (seen.has(l.href) ? false : (seen.add(l.href), true)));
  };
  const guides = dedupe([...(entry.guides ?? []), ...entry.group.guides]);
  const reference = dedupe([
    ...(entry.reference ?? []),
    ...entry.group.reference,
    ...(entry.kind === "yaml-js" ? [REF_ELEMENT] : []),
  ]);
  return { guides, reference, see: entry.see ?? [] };
}
