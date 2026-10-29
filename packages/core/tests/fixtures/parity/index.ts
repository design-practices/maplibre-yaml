/**
 * The parity corpus (U10, R4/R6): whole YAML documents that the checks
 * suites parse, kept here so `tests/parser/format-parity.test.ts` can run
 * each one again as JSON and TOML (converted with `convertDocument`) and
 * assert the same findings at the same keys.
 *
 * Each suite imports its documents from one namespace below and keeps its
 * assertions. A document is built from the same template the suite used, so
 * its text (and every line number a suite asserts) is unchanged.
 *
 * Every document a namespace builds is also recorded in
 * {@link PARITY_DOCUMENTS} with a short id, the suite that owns it and the
 * kind of document it is. A parametrised document (a template a suite calls
 * with each row of a table) is recorded once per row of the table exported
 * beside it, so the parity test sees exactly what the suite parses.
 *
 * Tiny fragments that are not whole documents stay in their suites.
 */

/** Which entry point the owning suite reads the document through. */
export type ParityKind = "map" | "story" | "any";

export interface ParityDocument {
  /** `<suite>/<name>`, unique. */
  id: string;
  /** The test file that owns the document, relative to `packages/core/tests/`. */
  suite: string;
  /** `map` = safeParseMapBlock, `story` = safeParseScrollytellingBlock, `any` = safeParseAny / safeParse. */
  kind: ParityKind;
  text: string;
}

const registry: ParityDocument[] = [];

/** Every document below, in the order the namespaces build them. */
export const PARITY_DOCUMENTS: readonly ParityDocument[] = registry;

function recorder(suite: string) {
  return (kind: ParityKind, name: string, text: string): string => {
    const id = `${suite.replace(/^.*\//, "").replace(/\.test\.ts$/, "")}/${name}`;
    if (registry.some((d) => d.id === id)) throw new Error(`duplicate parity document id ${id}`);
    registry.push({ id, suite, kind, text });
    return text;
  };
}

/** Record `build(row)` for every row, and return `build` for the suite to call. */
function each<B extends (row: never) => string>(
  add: ReturnType<typeof recorder>,
  kind: ParityKind,
  name: string,
  rows: readonly Parameters<B>[0][],
  build: B
): B {
  rows.forEach((row, i) => {
    const label = String(row);
    add(kind, `${name}[${/^[\w.\-, [\]]{1,24}$/.test(label) ? label : i}]`, build(row));
  });
  return build;
}

// ---------------------------------------------------------------------------
// parser/format-checks.test.ts
// ---------------------------------------------------------------------------

const fc = recorder("parser/format-checks.test.ts");

const fcV1 = (sources: string, layers = "layers: []") => `type: map
id: m
config:
  center: [10.2, 42.15]
  zoom: 9
  mapStyle: https://example.com/style.json
sources:
${sources}
${layers}
`;

const fcV2 = (sources: string) => `version: 2
type: map
id: m
style:
  basemap: https://example.com/style.json
  center: [10.2, 42.15]
  zoom: 9
  sources:
${sources}
  layers: []
`;

const fcStory = (sources: string) => `type: scrollytelling
id: s
config:
  center: [10.2, 42.15]
  zoom: 9
  mapStyle: https://example.com/style.json
sources:
${sources}
layers: []
chapters:
  - id: a
    title: A
    center: [10.2, 42.15]
    zoom: 9
`;

const fcColumnsStory = (sources: string) => `type: scrollytelling
id: s
config: { center: [10.2, 42.15], zoom: 9, mapStyle: https://example.com/style.json }
sources:
${sources}
layers:
  - { id: w, type: circle, source: w, paint: { circle-color: ["get", "kind"] } }
chapters:
  - id: a
    title: A
    center: [10.2, 42.15]
    zoom: 9
    onChapterEnter:
      - { action: setFilter, layer: w, filter: [">=", ["get", "value"], 50] }
`;

const FC_COLUMNS_STORY_PARQUET = `  w:\n    type: geojson\n    url: data/w.parquet\n    columns: [kind]`;

/** The words `type: <a file format>` is tried with. */
export const FILE_FORMAT_WORDS = ["pmtiles", "flatgeobuf", "fgb", "geoparquet", "parquet", "cog", "mbtiles"] as const;
/** The source bodies a geojson source is given a PMTiles archive with. */
export const PMTILES_ON_GEOJSON = [
  "    type: geojson\n    url: data/a.pmtiles",
  "    type: geojson\n    url: pmtiles://https://x.org/a",
  "    type: geojson\n    url: https://x.org/a\n    format: pmtiles",
] as const;
export const VALID_COLUMNS = ["[name, depth_m]", "all"] as const;
export const BAD_MAX_FEATURES = ["0", "-5", "1.5"] as const;

export const formatChecks = {
  validV1: fc(
    "map",
    "valid-v1",
    fcV1(`  tiles:
    type: vector
    url: data/buildings.pmtiles
  scheme:
    type: raster
    url: pmtiles://https://example.com/imagery.pmtiles
    tileSize: 256
  dem:
    type: raster-dem
    url: data/terrain.pmtiles
    encoding: terrarium
  parcels:
    type: geojson
    url: data/parcels.fgb
  api:
    type: geojson
    url: https://example.com/api/parcels?f=fgb
    format: flatgeobuf
    load: { mode: viewport, minzoom: 14 }`)
  ),
  validV2: fc(
    "map",
    "valid-v2",
    fcV2(`    tiles: { type: vector, url: "pmtiles://data/a.pmtiles" }
    parcels:
      type: geojson
      url: https://example.com/api/parcels
      runtime:
        format: flatgeobuf
        load: viewport`)
  ),
  validStory: fc(
    "story",
    "valid-story",
    fcStory(`  tiles: { type: vector, url: data/a.pmtiles }
  parcels: { type: geojson, url: data/p.fgb }`)
  ),
  fileFormatAsType: each(fc, "map", "file-format-as-type", FILE_FORMAT_WORDS, (word: string) =>
    fcV1(`  data:
    type: ${word}
    url: data/x.${word}`)
  ),
  fileFormatV2: fc("map", "file-format-v2", fcV2(`    data: { type: pmtiles, url: data/x.pmtiles }`)),
  fileFormatStory: fc("story", "file-format-story", fcStory(`  data: { type: pmtiles, url: data/x.pmtiles }`)),
  fileFormatInlineSource: fc(
    "map",
    "file-format-inline-source",
    fcV1(
      "  {}",
      `layers:
  - id: a
    type: fill
    source: { type: flatgeobuf, url: data/p.fgb }`
    )
  ),
  fgbOnTileSource: fc(
    "map",
    "fgb-on-tile-source",
    fcV1(`  p:
    type: vector
    url: data/parcels.fgb`)
  ),
  pmtilesOnGeojson: each(fc, "map", "pmtiles-on-geojson", PMTILES_ON_GEOJSON, (source: string) =>
    fcV1(`  a:\n${source}`)
  ),
  geotiffOnGeojson: fc("map", "geotiff-on-geojson", fcV1(`  a:\n    type: geojson\n    url: data/scene.tif`)),
  formatTypo: fc("map", "format-typo", fcV1(`  a:\n    type: geojson\n    url: https://x.org/a\n    format: flatgeobuff`)),
  formatExtension: fc("map", "format-extension", fcV1(`  a:\n    type: geojson\n    url: https://x.org/a\n    format: fgb`)),
  formatDisagrees: fc("map", "format-disagrees", fcV1(`  a:\n    type: vector\n    url: data/a.fgb\n    format: pmtiles`)),
  loadNoEffect: fc("map", "load-no-effect", fcV1(`  a:\n    type: geojson\n    url: data/a.geojson\n    load: viewport`)),
  loadParquetFlat: fc(
    "map",
    "load-parquet-flat",
    fcV1(`  a:\n    type: geojson\n    url: data/a.parquet\n    load: { mode: viewport, minzoom: 12 }`)
  ),
  loadParquetNested: fc(
    "map",
    "load-parquet-nested",
    fcV2(`    a:
      type: geojson
      url: https://example.com/api/wells
      runtime:
        format: geoparquet
        load: viewport
        columns: [kind, depth_m]`)
  ),
  loadUnknownMode: fc("map", "load-unknown-mode", fcV1(`  a:\n    type: geojson\n    url: data/a.fgb\n    load: lazy`)),
  columnsOnParquet: each(fc, "map", "columns-on-parquet", VALID_COLUMNS, (columns: string) =>
    fcV1(`  a:\n    type: geojson\n    url: data/a.parquet\n    columns: ${columns}`)
  ),
  columnsNoEffect: fc("map", "columns-no-effect", fcV1(`  a:\n    type: geojson\n    url: data/a.fgb\n    columns: [name]`)),
  columnsLeaveOut: fc(
    "map",
    "columns-leave-out",
    fcV1(
      `  t:\n    type: geojson\n    url: data/tracts.parquet\n    columns: [tract]`,
      `layers:
  - id: t
    type: fill
    source: t
    paint: { fill-color: "#ccc" }
    interactive:
      click:
        popup:
          - h3: [{ property: tract }]
          - p: [{ str: "Population: " }, { property: population }]
  - id: labels
    type: symbol
    source: t
    layout: { text-field: "{ Tract Name }" }
  - id: inline
    type: circle
    source: { type: geojson, url: data/wells.parquet, columns: [id] }
    filter: [">", ["get", "depth"], 10]`
    )
  ),
  /** A story's `sources:` body: `w` is a GeoParquet source with `columns: [kind]`. */
  columnsStoryParquet: FC_COLUMNS_STORY_PARQUET,
  columnsStory: each(
    fc,
    "story",
    "columns-story",
    [
      FC_COLUMNS_STORY_PARQUET,
      FC_COLUMNS_STORY_PARQUET.replace("[kind]", "[kind, value]"),
      FC_COLUMNS_STORY_PARQUET.replace("[kind]", "all"),
      FC_COLUMNS_STORY_PARQUET.replace("\n    columns: [kind]", ""),
    ],
    fcColumnsStory
  ),
  columnsEmpty: fc("map", "columns-empty", fcV1(`  a:\n    type: geojson\n    url: data/a.parquet\n    columns: []`)),
  columnsBareWord: fc("map", "columns-bare-word", fcV1(`  a:\n    type: geojson\n    url: data/a.parquet\n    columns: some`)),
  formatParquet: fc("map", "format-parquet", fcV1(`  a:\n    type: geojson\n    url: https://x.org/a\n    format: parquet`)),
  parquetOnTileSource: fc("map", "parquet-on-tile-source", fcV1(`  p:\n    type: vector\n    url: data/wells.parquet`)),
  parquetRefresh: fc(
    "map",
    "parquet-refresh",
    fcV1(`  a:
    type: geojson
    url: data/a.parquet
    refresh: { refreshInterval: 5000 }`)
  ),
  parquetStream: fc(
    "map",
    "parquet-stream",
    fcV2(`    a:
      type: geojson
      url: data/a.parquet
      runtime:
        stream: { type: sse, url: https://example.com/s }`)
  ),
  fgbRefreshV1: fc(
    "map",
    "fgb-refresh-v1",
    fcV1(`  a:
    type: geojson
    url: data/a.fgb
    refresh: { refreshInterval: 5000 }`)
  ),
  fgbRefreshV2: fc(
    "map",
    "fgb-refresh-v2",
    fcV2(`    a:
      type: geojson
      url: data/a.fgb
      runtime:
        refresh: { refreshInterval: 5000 }`)
  ),
  parquetAndCogClean: fc(
    "map",
    "parquet-and-cog-clean",
    fcV1(`  wells:
    type: geojson
    url: data/wells.parquet
  also:
    type: geojson
    url: data/wells.geoparquet
  scene:
    type: raster
    url: data/scene.tif`)
  ),
  formatGeoparquet: fc("map", "format-geoparquet", fcV1(`  a:\n    type: geojson\n    url: https://x.org/a\n    format: geoparquet`)),
  formatCog: fc("map", "format-cog", fcV1(`  a:\n    type: raster\n    url: https://x.org/a\n    format: cog`)),
  maxFeaturesFlat: fc(
    "map",
    "max-features-flat",
    fcV1(`  lots:
    type: geojson
    url: data/lots.parquet
    load: { mode: viewport, minzoom: 12, maxFeatures: 50000 }`)
  ),
  maxFeaturesNested: fc(
    "map",
    "max-features-nested",
    fcV2(`    lots:
      type: geojson
      url: data/lots.fgb
      runtime:
        load: { mode: viewport, maxFeatures: 20000 }`)
  ),
  maxFeaturesBad: each(fc, "map", "max-features-bad", BAD_MAX_FEATURES, (value: string) =>
    fcV1(`  lots:
    type: geojson
    url: data/lots.fgb
    load: { mode: viewport, maxFeatures: ${value} }`)
  ),
  maxFeaturesAlone: fc(
    "map",
    "max-features-alone",
    fcV1(`  lots:
    type: geojson
    url: data/lots.parquet
    load: { maxFeatures: 600000 }`)
  ),
  maxFeaturesModeAll: fc(
    "map",
    "max-features-mode-all",
    fcV1(`  lots:
    type: geojson
    url: data/lots.parquet
    load: { mode: all, maxFeatures: 600000 }`)
  ),
  maxFeaturesZero: fc(
    "map",
    "max-features-zero",
    fcV1(`  lots:
    type: geojson
    url: data/lots.parquet
    load: { maxFeatures: 0 }`)
  ),
  maxFeaturesWord: fc(
    "map",
    "max-features-word",
    fcV1(`  lots:
    type: geojson
    url: data/lots.fgb
    load: { mode: viewport, maxFeatures: lots }`)
  ),
  overviewsOffFlat: fc(
    "map",
    "overviews-off-flat",
    fcV1(`  lots:
    type: geojson
    url: data/lots.parquet
    load: { mode: viewport, overviews: false }`)
  ),
  overviewsOffNested: fc(
    "map",
    "overviews-off-nested",
    fcV2(`    lots:
      type: geojson
      url: https://example.com/api/lots
      runtime:
        format: geoparquet
        load: { overviews: false }`)
  ),
  overviewsOnFgb: fc(
    "map",
    "overviews-on-fgb",
    fcV1(`  lots:
    type: geojson
    url: data/lots.fgb
    load: { mode: viewport, overviews: true }`)
  ),
  overviewsOnFgbNested: fc(
    "map",
    "overviews-on-fgb-nested",
    fcV2(`    lots:
      type: geojson
      url: data/lots.fgb
      runtime:
        load: { mode: viewport, overviews: false }`)
  ),
  overviewsWord: fc(
    "map",
    "overviews-word",
    fcV1(`  lots:
    type: geojson
    url: data/lots.parquet
    load: { mode: viewport, overviews: "no" }`)
  ),
};

// ---------------------------------------------------------------------------
// parser/student-mistakes.test.ts
// ---------------------------------------------------------------------------

const sm = recorder("parser/student-mistakes.test.ts");

/** A map document with `config` and the first layer's `paint` swapped in. */
function smDoc({
  config = "  center: [-98, 39]\n  zoom: 3",
  paint = '      circle-color: "#ef4444"',
  extra = "",
}: { config?: string; paint?: string; extra?: string } = {}): string {
  return `type: map
id: m
config:
${config}
  mapStyle: "https://demotiles.maplibre.org/style.json"
${extra}layers:
  - id: cities
    type: circle
    source:
      type: geojson
      data: { type: FeatureCollection, features: [] }
    paint:
${paint}
`;
}

const smWithSources = (ref: string, layerExtra = "") =>
  smDoc({
    extra: "sources:\n  cities:\n    type: geojson\n    data: { type: FeatureCollection, features: [] }\n",
  }).replace(
    "    source:\n      type: geojson\n      data: { type: FeatureCollection, features: [] }",
    `    source: ${ref}${layerExtra}`
  );

export const ZOOM_TYPOS = ["Zoom", "zom"] as const;
export const RELATIVE_DATA_URLS = ["data/cities.geojson", "cities.geojson", "./cities.geojson", "/data/cities.geojson"] as const;

export const studentMistakes = {
  centreTypo: sm("map", "centre-typo", smDoc({ config: "  centre: [-98, 39]\n  zoom: 3" })),
  zoomTypo: each(sm, "map", "zoom-typo", ZOOM_TYPOS, (typo: string) =>
    smDoc({ config: `  center: [-98, 39]\n  ${typo}: 3` })
  ),
  latLng: sm("map", "lat-lng", smDoc({ config: "  lat: 39\n  lng: -98\n  zoom: 3" })),
  missingCenter: sm("map", "missing-center", smDoc({ config: "  zoom: 3" })),
  optionalKeyVariant: sm("map", "optional-key-variant", smDoc({ config: "  center: [-98, 39]\n  zoom: 3\n  bearIng: 10" })),
  passthroughOption: sm(
    "map",
    "passthrough-option",
    smDoc({ config: "  center: [-98, 39]\n  zoom: 3\n  cooperativeGestures: true" })
  ),
  unquotedHex: sm("map", "unquoted-hex", smDoc({ paint: "      circle-radius: 10\n      circle-color: #ef4444" })),
  emptyKeyComment: sm("map", "empty-key-comment", smDoc({ paint: "      circle-color: # TODO pick one" })),
  hexInFlowMap: sm(
    "map",
    "hex-in-flow-map",
    smDoc({ paint: '      { "circle-color": #ef4444, "circle-radius": 10 }' }).replace("    paint:\n      {", "    paint: {")
  ),
  colourNameTypo: sm("map", "colour-name-typo", smDoc({ paint: '      circle-color: "bleu"' })),
  curlyQuotes: sm("map", "curly-quotes", smDoc({ paint: "      circle-color: “#ef4444”" })),
  numberWithUnits: sm("map", "number-with-units", smDoc({ paint: '      circle-radius: "10px"' })),
  latLonSwapped: sm("map", "lat-lon-swapped", smDoc({ config: "  center: [39, -98]\n  zoom: 3" })),
  typeCase: sm("map", "type-case", smDoc().replace("type: map", "type: Map")),
  sourceTypo: sm("map", "source-typo", smWithSources("citeis")),
  basemapSourceNoSourceLayer: sm("map", "basemap-source-no-source-layer", smWithSources("openmaptiles")),
  nearMissWithSourceLayer: sm(
    "map",
    "near-miss-with-source-layer",
    smWithSources("citeis", "\n    source-layer: places")
  ),
  basemapSourceWithSourceLayer: sm(
    "map",
    "basemap-source-with-source-layer",
    smWithSources("openmaptiles", "\n    source-layer: place")
  ),
  relativeDataUrl: each(sm, "map", "relative-data-url", RELATIVE_DATA_URLS, (url: string) =>
    smDoc().replace("data: { type: FeatureCollection, features: [] }", `url: "${url}"`)
  ),
};

// ---------------------------------------------------------------------------
// parser/cog-checks.test.ts
// ---------------------------------------------------------------------------

const cg = recorder("parser/cog-checks.test.ts");

const cgV1 = (sources: string) => `type: map
id: m
config:
  center: [10.2, 42.15]
  zoom: 9
  mapStyle: https://example.com/style.json
sources:
${sources}
layers: []
`;

const cgV2 = (sources: string) => `version: 2
type: map
id: m
style:
  basemap: https://example.com/style.json
  center: [10.2, 42.15]
  zoom: 9
  sources:
${sources}
  layers: []
`;

const cgStory = (sources: string) => `type: scrollytelling
id: s
config:
  center: [10.2, 42.15]
  zoom: 9
  mapStyle: https://example.com/style.json
sources:
${sources}
layers: []
chapters:
  - id: a
    title: A
    center: [10.2, 42.15]
    zoom: 9
`;

export const COG_TYPE_WORDS = ["cog", "geotiff", "tif"] as const;

export const cogChecks = {
  validV1: cg(
    "map",
    "valid-v1",
    cgV1(`  imagery: { type: raster, url: data/imagery.tif }
  elevation: { type: raster-dem, url: "cog://data/elevation.tif" }
  ndvi:
    type: raster
    url: data/ndvi.tif
    colorRamp: { palette: YlGn, min: 0, max: 0.9 }
  big: { type: raster, url: data/big.tif, tileSize: 512 }
  plain: { type: raster, url: https://tiles.example.com/tiles.json }`)
  ),
  validV2: cg(
    "map",
    "valid-v2",
    cgV2(`    ndvi:
      type: raster
      url: data/ndvi.tif
      runtime:
        colorRamp: { palette: viridis, min: 0, max: 1 }`)
  ),
  validStory: cg("story", "valid-story", cgStory(`  dem: { type: raster-dem, url: data/dem.tiff }`)),
  paletteTypo: cg(
    "map",
    "palette-typo",
    cgV1(`  ndvi:
    type: raster
    url: data/ndvi.tif
    colorRamp: { palette: virdis, min: 0, max: 1 }`)
  ),
  rampMistakes: cg(
    "map",
    "ramp-mistakes",
    cgV1(`  a:
    type: raster
    url: a.tif
    colorRamp: { colors: ["#000", red], min: 1, max: 0 }
  b:
    type: raster
    url: b.tif
    colorRamp: { palette: Blues, classes: 12, min: 0, max: 1 }
  c:
    type: raster
    url: c.tif
    colorRamp: { palette: Blues, colors: ["#000", "#fff"], min: 0, max: 1 }`)
  ),
  rampWarnings: cg(
    "map",
    "ramp-warnings",
    cgV1(`  a:
    type: raster
    url: a.tif
    colorRamp: { palette: okabe-ito, min: 0, max: 1 }
  b:
    type: raster
    url: b.tif
    colorRamp: { palette: Set1, classes: 5, min: 0, max: 1 }
  c:
    type: raster
    url: c.tif
    tileSize: 512
    colorRamp: { palette: viridis, min: 0, max: 1 }`)
  ),
  rampMissingMinMax: cg("map", "ramp-missing-min-max", cgV1(`  a: { type: raster, url: a.tif, colorRamp: { palette: viridis } }`)),
  rampWhereItDoesNothing: cg(
    "map",
    "ramp-where-it-does-nothing",
    cgV1(`  dem:
    type: raster-dem
    url: dem.tif
    colorRamp: { min: 0, max: 1 }
  tiles:
    type: raster
    url: https://tiles.example.com/tiles.json
    colorRamp: { min: 0, max: 1 }
  both:
    type: raster
    url: "t.tif#color:CartoEarth,1,100"
    colorRamp: { min: 0, max: 1 }`)
  ),
  terrariumOnCog: cg("map", "terrarium-on-cog", cgV1(`  dem: { type: raster-dem, url: dem.tif, encoding: terrarium }`)),
  cogAsType: each(cg, "map", "cog-as-type", COG_TYPE_WORDS, (word: string) => cgV1(`  a: { type: ${word}, url: a.tif }`)),
  tifOnGeojson: cg("map", "tif-on-geojson", cgV1(`  a: { type: geojson, url: data/a.tif }`)),
};

// ---------------------------------------------------------------------------
// parser/reserved-prefix.test.ts
// ---------------------------------------------------------------------------

const rp = recorder("parser/reserved-prefix.test.ts");

const RP_STYLE = '"https://demotiles.maplibre.org/style.json"';

const rpV1 = (layer: string) => `type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: ${RP_STYLE}
layers:
${layer}
`;

export const reservedPrefix = {
  v1Layout: rp(
    "map",
    "v1-layout",
    rpV1(`  - id: labels
    type: symbol
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
    layout:
      text-field: "=upper({name})"`)
  ),
  v2Paint: rp(
    "map",
    "v2-paint",
    `version: 2
type: map
id: m
style:
  center: [0, 0]
  zoom: 2
  basemap: ${RP_STYLE}
  sources: {}
  layers:
    - id: bg
      type: background
      paint:
        background-opacity: "=0.5"
`
  ),
  expressionsAndFilters: rp(
    "map",
    "expressions-and-filters",
    rpV1(`  - id: a
    type: circle
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
    filter: ["all", ["==", ["get", "kind"], "park"], ["==", "kind", "park"], ["==", ["get", "x"], "=y"]]
    paint:
      circle-color: ["case", ["==", ["get", "k"], "=x"], "red", "blue"]`)
  ),
  literalEscape: rp(
    "map",
    "literal-escape",
    rpV1(`  - id: labels
    type: symbol
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
    layout:
      text-field: ["literal", "=5"]`)
  ),
  storyActions: rp(
    "story",
    "story-actions",
    `type: scrollytelling
id: s
config:
  center: [0, 0]
  zoom: 2
  mapStyle: ${RP_STYLE}
chapters:
  - id: one
    title: "=Results"
    description: "= totals below"
    center: [0, 0]
    zoom: 2
    onChapterEnter:
      - action: setPaintProperty
        layer: pts
        property: circle-color
        value: "=red"
`
  ),
  pagesDocument: rp(
    "any",
    "pages-document",
    `pages:
  - path: /
    title: Home
    blocks:
      - type: map
        id: m
        config: { center: [0, 0], zoom: 2, mapStyle: ${RP_STYLE} }
        layers:
          - id: l
            type: symbol
            source: { type: geojson, data: { type: FeatureCollection, features: [] } }
            layout: { text-field: "=name" }
`
  ),
};

// ---------------------------------------------------------------------------
// parser/layer-source-refs.test.ts
// ---------------------------------------------------------------------------

const ls = recorder("parser/layer-source-refs.test.ts");

const EMPTY = "{ type: FeatureCollection, features: [] }";

const lsMap = (body: string, mapStyle = "https://example.com/style.json") =>
  `type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: ${mapStyle}
${body}`;

const LS_INLINE_STYLE = `{ version: 8, sources: { osm: { type: raster, tiles: ["https://t/{z}/{x}/{y}.png"] } }, layers: [] }`;

const lsV2 = (source: string) => `version: 2
type: map
id: m
style:
  basemap: https://example.com/style.json
  center: [0, 0]
  zoom: 2
  sources:
    quakes:
      type: geojson
      data: ${EMPTY}
  layers:
    - id: dots
      type: circle
      source: ${source}
`;

const lsStory = (source: string) => `type: scrollytelling
id: s
config:
  center: [0, 0]
  zoom: 2
  mapStyle: https://example.com/style.json
sources:
  quakes:
    type: geojson
    data: ${EMPTY}
layers:
  - id: dots
    type: circle
    source: ${source}
chapters:
  - id: a
    title: A
    center: [0, 0]
    zoom: 2
    layers: { show: [dots] }
`;

const lsRoot = (blockLayerSource: string, recordLayerSource = "quakes") => `config:
  defaultMapStyle: https://example.com/style.json
sources:
  quakes:
    type: geojson
    data: ${EMPTY}
layers:
  shared:
    id: shared
    type: circle
    source: ${recordLayerSource}
pages:
  - path: /
    title: Home
    blocks:
      - type: map
        id: a
        config: { center: [0, 0], zoom: 2 }
        sources:
          parks:
            type: geojson
            data: ${EMPTY}
        layers:
          - id: dots
            type: circle
            source: ${blockLayerSource}
          - $ref: "#/layers/shared"
`;

export const layerSourceRefs = {
  v1NamedTypo: ls(
    "any",
    "v1-named-typo",
    lsMap(`sources:
  quakes:
    type: geojson
    data: ${EMPTY}
layers:
  - id: dots
    type: circle
    source: quake
`)
  ),
  definedNames: ls(
    "map",
    "defined-names",
    lsMap(`sources:
  quakes:
    type: geojson
    data: ${EMPTY}
layers:
  - id: bg
    type: background
    paint: { background-color: "#fff" }
  - id: dots
    type: circle
    source: quakes
  - id: inline
    type: circle
    source: { type: geojson, data: ${EMPTY} }
  - id: halo
    type: circle
    source: inline-source
`)
  ),
  inlineSourceId: ls(
    "map",
    "inline-source-id",
    lsMap(`layers:
  - id: clusters
    type: circle
    source:
      id: quakes
      type: geojson
      data: ${EMPTY}
  - id: counts
    type: symbol
    source: quakes
`)
  ),
  layerIdAsSource: ls(
    "map",
    "layer-id-as-source",
    lsMap(`layers:
  - id: earthquakes
    type: circle
    source: { type: geojson, data: ${EMPTY} }
  - id: counts
    type: symbol
    source: earthquakes
`)
  ),
  noSources: ls(
    "map",
    "no-sources",
    lsMap(`layers:
  - id: dots
    type: circle
    source: quakes
`)
  ),
  basemapNames: ls(
    "map",
    "basemap-names",
    lsMap(`layers:
  - id: buildings
    type: fill-extrusion
    source: openmaptiles
    source-layer: building
  - id: hillshade
    type: hillshade
    source: terrain
`)
  ),
  inlineStyleKnown: ls(
    "map",
    "inline-style-known",
    lsMap(
      `layers:
  - id: base
    type: raster
    source: osm
`,
      LS_INLINE_STYLE
    )
  ),
  inlineStyleTypo: ls(
    "map",
    "inline-style-typo",
    lsMap(
      `layers:
  - id: base
    type: raster
    source: osn
`,
      LS_INLINE_STYLE
    )
  ),
  protomapsSource: ls(
    "map",
    "protomaps-source",
    lsMap(
      `layers:
  - id: water
    type: fill
    source: protomaps
    source-layer: water
`,
      "data/basemap.pmtiles"
    )
  ),
  protomapsOtherSource: ls(
    "map",
    "protomaps-other-source",
    lsMap(
      `layers:
  - id: water
    type: fill
    source: openmaptiles
    source-layer: water
`,
      "data/basemap.pmtiles"
    )
  ),
  v2: each(ls, "map", "v2", ["quakes", "quaks"], lsV2),
  story: each(ls, "story", "story", ["quakes", "quake"], lsStory),
  /** `root(blockLayerSource, recordLayerSource)`, for the rows the suite parses. */
  root: lsRoot,
  rootBlockQuakes: ls("any", "root-block-quakes", lsRoot("quakes")),
  rootBlockParks: ls("any", "root-block-parks", lsRoot("parks")),
  rootRecordUsesBlockSource: ls("any", "root-record-uses-block-source", lsRoot("quakes", "parks")),
  rootBlockTypo: ls("any", "root-block-typo", lsRoot("quaks")),
  rootRecordTypo: ls("any", "root-record-typo", lsRoot("quakes", "prks")),
  rootOtherPageSource: ls(
    "any",
    "root-other-page-source",
    lsRoot("parks").replace(
      "          - $ref: \"#/layers/shared\"\n",
      `          - $ref: "#/layers/shared"
  - path: /other
    title: Other
    blocks:
      - type: map
        id: b
        config: { center: [0, 0], zoom: 2 }
        layers:
          - id: more
            type: circle
            source: parks
`
    )
  ),
};

// ---------------------------------------------------------------------------
// classify/parse.test.ts
// ---------------------------------------------------------------------------

const cl = recorder("classify/parse.test.ts");

/** The map head every classify layer list is appended to. */
const CL_HEAD = `type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
sources:
  tracts:
    type: geojson
    url: /data/tracts.geojson
  tiles:
    type: vector
    url: https://example.com/tiles.json
layers:
`;

const clMap = (layers: string) => CL_HEAD + layers;
const clTractsRead = (load: string, layers: string) =>
  CL_HEAD.replace("url: /data/tracts.geojson", `url: /data/tracts.fgb\n    load: ${load}`) + layers;

const CL_BREAKS = Array.from({ length: 12 }, (_, i) => (i + 1) * 10); // 13 classes
const CL_COLORS = CL_BREAKS.map(() => '"#123456"').concat('"#654321"');

export const classifyParse = {
  fourForms: cl(
    "map",
    "four-forms",
    clMap(`  - id: explicit
    type: fill
    source: tracts
    classify:
      field: income
      breaks: [25000, 50000, 75000]
      palette: Blues
  - id: computed
    type: fill
    source: tracts
    classify:
      field: income
      method: quantile
      classes: 5
      palette: ylorrd
      noData: hide
  - id: zones
    type: fill
    source: tracts
    classify:
      field: zone
      categories:
        residential: "#f6e8c3"
        commercial: "#d8b365"
      other: "#bbbbbb"
  - id: places
    type: circle
    source: tracts
    classify:
      field: pop
      breaks: [1000, 10000]
      palette: Reds
      radius: [4, 8, 14]
`)
  ),
  vectorExplicitBreaks: cl(
    "map",
    "vector-explicit-breaks",
    clMap(`  - id: v
    type: fill
    source: tiles
    source-layer: tracts
    classify: { field: income, breaks: [10, 20] }
`)
  ),
  methodTypo: cl(
    "map",
    "method-typo",
    clMap(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, method: natural-breaks }
`)
  ),
  paletteTypo: cl(
    "map",
    "palette-typo",
    clMap(`  - id: a
    type: fill
    source: tracts
    classify:
      field: v
      breaks: [1, 2]
      palette: ylgnbuu
`)
  ),
  paletteTooFewColours: cl(
    "map",
    "palette-too-few-colours",
    clMap(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, method: quantile, classes: 12, palette: Blues }
`)
  ),
  tooManyClasses: cl(
    "map",
    "too-many-classes",
    clMap(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, breaks: [${CL_BREAKS.join(", ")}] }
`)
  ),
  twelveClasses: cl(
    "map",
    "twelve-classes",
    clMap(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, breaks: [${CL_BREAKS.slice(0, 11).join(", ")}] }
`)
  ),
  manyClassesWithColors: cl(
    "map",
    "many-classes-with-colors",
    clMap(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, breaks: [${CL_BREAKS.join(", ")}], colors: [${CL_COLORS.join(", ")}] }
`)
  ),
  breaksGoDown: cl(
    "map",
    "breaks-go-down",
    clMap(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, breaks: [10, 5] }
`)
  ),
  colourCount: cl(
    "map",
    "colour-count",
    clMap(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, breaks: [10, 20], colors: [red, blue] }
`)
  ),
  noForm: cl(
    "map",
    "no-form",
    clMap(`  - id: a
    type: fill
    source: tracts
    classify: { field: v }
`)
  ),
  twoForms: cl(
    "map",
    "two-forms",
    clMap(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, breaks: [1], method: quantile }
`)
  ),
  noDataTypo: cl(
    "map",
    "no-data-typo",
    clMap(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, breaks: [1], noData: greyy }
`)
  ),
  schemeKey: cl(
    "map",
    "scheme-key",
    clMap(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, breaks: [1], scheme: Blues }
`)
  ),
  unknownKey: cl(
    "map",
    "unknown-key",
    clMap(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, breaks: [1], pallete: Blues }
`)
  ),
  categoriesNumericKeys: cl(
    "map",
    "categories-numeric-keys",
    clMap(`  - id: zones
    type: fill
    source: tracts
    classify:
      field: code
      categories:
        10: red
        2: green
        b: blue
        1: black
`)
  ),
  categoriesWordKeys: cl(
    "map",
    "categories-word-keys",
    clMap(`  - id: zones
    type: fill
    source: tracts
    classify:
      field: zone
      categories: { residential: "#f6e8c3", commercial: "#d8b365" }
`)
  ),
  methodOverTiles: cl(
    "map",
    "method-over-tiles",
    clMap(`  - id: v
    type: fill
    source: tiles
    source-layer: tracts
    classify: { field: income, method: quantile }
`)
  ),
  methodOverBasemap: cl(
    "map",
    "method-over-basemap",
    clMap(`  - id: v
    type: fill
    source: openmaptiles
    source-layer: water
    classify: { field: income, method: jenks }
`)
  ),
  methodOverViewportBare: cl(
    "map",
    "method-over-viewport-bare",
    clTractsRead(
      "viewport",
      `  - id: v
    type: fill
    source: tracts
    classify: { field: income, method: quantile }
`
    )
  ),
  methodOverViewportObject: cl(
    "map",
    "method-over-viewport-object",
    clTractsRead(
      "{ mode: viewport, minzoom: 12 }",
      `  - id: v
    type: fill
    source: tracts
    classify: { field: income, method: quantile }
`
    )
  ),
  methodOverViewportInline: cl(
    "map",
    "method-over-viewport-inline",
    clMap(`  - id: v
    type: fill
    source: { type: geojson, url: /data/t.fgb, load: { mode: viewport } }
    classify: { field: income, method: jenks }
`)
  ),
  methodOverViewportParquet: cl(
    "map",
    "method-over-viewport-parquet",
    CL_HEAD.replace("url: /data/tracts.geojson", "url: /data/tracts.parquet\n    load: viewport") +
      `  - id: v
    type: fill
    source: tracts
    classify: { field: income, method: quantile, classes: 4 }
`
  ),
  methodOverViewportParquetFormat: cl(
    "map",
    "method-over-viewport-parquet-format",
    CL_HEAD.replace("url: /data/tracts.geojson", "url: /data/tracts\n    format: geoparquet\n    load: { mode: viewport }") +
      `  - id: v
    type: fill
    source: tracts
    classify: { field: income, method: jenks, normalize: area }
`
  ),
  breaksOverViewport: cl(
    "map",
    "breaks-over-viewport",
    clTractsRead(
      "{ mode: viewport }",
      `  - id: v
    type: fill
    source: tracts
    classify: { field: income, breaks: [10, 20] }
`
    )
  ),
  paintClash: cl(
    "map",
    "paint-clash",
    clMap(`  - id: a
    type: fill
    source: tracts
    paint:
      fill-color: red
    classify: { field: v, breaks: [1] }
`)
  ),
  otherPaintProperty: cl(
    "map",
    "other-paint-property",
    clMap(`  - id: a
    type: fill
    source: tracts
    paint:
      fill-color: red
    classify: { field: v, breaks: [1], property: fill-outline-color }
`)
  ),
  propertyTypo: cl(
    "map",
    "property-typo",
    clMap(`  - id: a
    type: circle
    source: tracts
    classify: { field: v, breaks: [1], property: circle-colour }
`)
  ),
  heatmapLayer: cl(
    "map",
    "heatmap-layer",
    clMap(`  - id: a
    type: heatmap
    source: tracts
    classify: { field: v, breaks: [1] }
`)
  ),
  radiusOffCircle: cl(
    "map",
    "radius-off-circle",
    clMap(`  - id: a
    type: fill
    source: tracts
    classify: { field: v, breaks: [1], radius: [2, 4] }
`)
  ),
  hideOverLegacyFilter: cl(
    "map",
    "hide-over-legacy-filter",
    clMap(`  - id: a
    type: fill
    source: tracts
    filter: ["==", "kind", "park"]
    classify: { field: v, breaks: [1], noData: hide }
`)
  ),
  layerAndBlockErrors: cl(
    "map",
    "layer-and-block-errors",
    clMap(`  - id: a
    type: fill
    source: tiles
    source-layer: t
    paint: { fill-color: red }
    classify: { field: v, method: quantile, palette: bleus }
`)
  ),
  v2Valid: cl(
    "map",
    "v2-valid",
    `version: 2
type: map
id: m
style:
  center: [0, 0]
  zoom: 2
  sources:
    tracts: { type: geojson, url: /t.geojson }
  layers:
    - id: a
      type: fill
      source: tracts
      classify: { field: v, method: equal, classes: 4, palette: Greens }
`
  ),
  v2MethodOverTiles: cl(
    "map",
    "v2-method-over-tiles",
    `version: 2
type: map
id: m
style:
  center: [0, 0]
  zoom: 2
  sources:
    tiles: { type: vector, url: "https://example.com/t.json" }
  layers:
    - id: a
      type: fill
      source: tiles
      source-layer: x
      classify: { field: v, method: equal }
`
  ),
  v2MethodOverViewport: cl(
    "map",
    "v2-method-over-viewport",
    `version: 2
type: map
id: m
style:
  center: [0, 0]
  zoom: 2
  sources:
    parcels:
      type: geojson
      url: /p.fgb
      runtime:
        load: { mode: viewport, minzoom: 12 }
  layers:
    - id: a
      type: fill
      source: parcels
      classify: { field: v, method: quantile }
`
  ),
  storyMethodOverTiles: cl(
    "story",
    "story-method-over-tiles",
    `type: scrollytelling
id: s
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "https://demotiles.maplibre.org/style.json"
sources:
  tiles: { type: vector, url: "https://example.com/t.json" }
layers:
  - id: a
    type: fill
    source: tiles
    source-layer: x
    classify: { field: v, method: jenks }
chapters:
  - id: one
    title: One
    center: [0, 0]
    zoom: 2
`
  ),
};

// ---------------------------------------------------------------------------
// parser/inert-keys.test.ts
// ---------------------------------------------------------------------------

const ik = recorder("parser/inert-keys.test.ts");

const ikMap = (source: string) => `type: map
id: m
config:
  center: [10.2, 42.15]
  zoom: 9
  mapStyle: https://example.com/style.json
sources:
  data:
    type: geojson
    url: https://example.com/d.geojson
${source}
layers:
  - id: dots
    type: circle
    source: data
`;

export const FETCH_STRATEGIES = ["build", "hybrid"] as const;

export const inertKeys = {
  fetchStrategy: each(ik, "map", "fetch-strategy", [...FETCH_STRATEGIES, "runtime"], (strategy: string) =>
    ikMap(`    fetchStrategy: ${strategy}`)
  ),
  v2FetchStrategy: ik(
    "map",
    "v2-fetch-strategy",
    `version: 2
type: map
id: m
style:
  basemap: https://example.com/style.json
  center: [0, 0]
  zoom: 2
  sources:
    data:
      type: geojson
      url: https://example.com/d.geojson
      runtime:
        fetchStrategy: build
  layers:
    - id: dots
      type: circle
      source: data
`
  ),
  root: ik(
    "any",
    "root",
    `config:
  title: Site
  theme: dark
  dataFetching:
    defaultStrategy: build
    timeout: 5000
pages:
  - path: /
    title: Home
    blocks:
      - type: content
        content:
          - h1: [{ str: Hello }]
      - type: mixed
        blocks:
          - type: content
            content:
              - p: [{ str: Side }]
      - type: map-fullpage
        id: full
        config:
          center: [0, 0]
          zoom: 2
          mapStyle: https://example.com/style.json
  - path: /two
    title: Two
    blocks:
      - type: content
        content:
          - p: [{ str: Again }]
`
  ),
  plainMap: ik("map", "plain-map", ikMap("")),
  storyTheme: ik(
    "story",
    "story-theme",
    `type: scrollytelling
id: s
theme: dark
config:
  center: [0, 0]
  zoom: 2
  mapStyle: https://example.com/style.json
chapters:
  - id: one
    title: One
    center: [0, 0]
    zoom: 3
`
  ),
};

// ---------------------------------------------------------------------------
// parser/format-parity.test.ts (documents only the parity test parses)
// ---------------------------------------------------------------------------

const fp = recorder("parser/format-parity.test.ts");

/**
 * Findings whose message quotes line numbers ("lines X and Y"), which must
 * quote each format's own lines. No checks suite above has one.
 */
export const formatParity = {
  duplicateLayerIds: fp(
    "map",
    "duplicate-layer-ids",
    `type: map
id: m
config:
  center: [0, 0]
  zoom: 2
  mapStyle: https://example.com/style.json
sources:
  quakes:
    type: geojson
    data: ${EMPTY}
layers:
  - id: places
    type: circle
    source: quakes
  - id: places
    type: circle
    source: quakes
    paint: { circle-color: "#e11d48" }
`
  ),
  duplicateChapterIds: fp(
    "story",
    "duplicate-chapter-ids",
    `type: scrollytelling
id: s
config:
  center: [0, 0]
  zoom: 2
  mapStyle: https://example.com/style.json
chapters:
  - id: intro
    title: Intro
    center: [0, 0]
    zoom: 2
  - id: intro
    title: Again
    center: [10, 10]
    zoom: 4
`
  ),
};
