/**
 * Every emitted style must load in MapLibre: maplibre-gl refuses the whole
 * style over one invalid source (ml-xzx — a named `{type: geojson, url}`
 * source was written verbatim). Representative documents run through
 * `mlym emit`'s pipeline and the style-spec's own validator.
 */

import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { YAMLParser } from '@maplibre-yaml/core';
import { emitStyle } from '../src/commands/emit';
import { createDataLoader } from '../src/lib/data-loader';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURES = join(REPO, 'docs/public/gallery-assets/cloud-native');
const DOC_PATH = join(FIXTURES, 'map.yaml');

const HEAD = `type: map
id: valid
config:
  center: [10.2, 42.15]
  zoom: 10
  mapStyle: "https://demotiles.maplibre.org/style.json"
`;

const parse = (yaml: string) => {
  const result = YAMLParser.safeParseMapBlock(HEAD + yaml);
  if (!result.success) throw new Error(JSON.stringify(result.errors));
  return result.data;
};

const TRACTS = {
  type: 'FeatureCollection',
  features: [1, 5, 9, 20].map((v, i) => ({
    type: 'Feature',
    properties: { v },
    geometry: { type: 'Point', coordinates: [10 + i * 0.1, 42] },
  })),
};

/** Local fixtures (FlatGeobuf), plus an in-memory GeoJSON for `/data/tracts.geojson`. */
const fileLoader = createDataLoader(DOC_PATH);
const loadData = async (url: string) => (url.endsWith('tracts.geojson') ? TRACTS : fileLoader(url));

async function emitValid(yaml: string) {
  const { style, warnings } = await emitStyle(parse(yaml), 'with-fallbacks', { trust: 'untrusted' }, {
    loadData,
    documentPath: DOC_PATH,
  });
  // maplibre-gl 6 refuses the whole style on any of these.
  expect(validateStyleMin(style as never)).toEqual([]);
  return { style, warnings, sources: style.sources as Record<string, Record<string, unknown>> };
}

describe('emitted styles pass the MapLibre style-spec validator', () => {
  it('a named GeoJSON url: source (ml-xzx) emits as data: <url>', async () => {
    const { sources } = await emitValid(`sources:
  pts:
    type: geojson
    url: data/points.geojson
layers:
  - { id: p, type: circle, source: pts }
`);
    expect(sources.pts).toEqual({ type: 'geojson', data: 'data/points.geojson' });
  });

  it('an inline GeoJSON url: source on a layer emits as data: <url>', async () => {
    const { sources } = await emitValid(`layers:
  - id: p
    type: circle
    source: { type: geojson, url: data/points.geojson }
`);
    expect(sources['p-source']).toEqual({ type: 'geojson', data: 'data/points.geojson' });
  });

  it('a classify method: over a url: source, breaks baked', async () => {
    const { style, sources } = await emitValid(`sources:
  tracts:
    type: geojson
    url: /data/tracts.geojson
layers:
  - id: t
    type: circle
    source: tracts
    classify: { field: v, method: quantile, classes: 3, palette: Blues }
`);
    expect(sources.tracts).toEqual({ type: 'geojson', data: '/data/tracts.geojson' });
    const layer = (style.layers as Record<string, unknown>[]).find((l) => l.id === 't')!;
    expect(JSON.stringify(layer.paint)).toContain('"step"');
  });

  it('a FlatGeobuf source, inlined (and classified from the decoded features)', async () => {
    const { sources } = await emitValid(`sources:
  districts:
    type: geojson
    url: districts.fgb
layers:
  - id: d
    type: fill
    source: districts
    classify: { field: population, method: quantile, classes: 3, palette: Blues }
`);
    expect((sources.districts.data as { features: unknown[] }).features).toHaveLength(48);
    expect(sources.districts.url).toBeUndefined();
  });

  it('PMTiles vector and raster sources', async () => {
    const { sources } = await emitValid(`sources:
  tiles:
    type: vector
    url: districts.pmtiles
  imagery:
    type: raster
    url: imagery.pmtiles
    tileSize: 256
layers:
  - { id: t, type: line, source: tiles, source-layer: districts }
  - { id: i, type: raster, source: imagery }
`);
    expect(sources.tiles.url).toBe('pmtiles://districts.pmtiles');
    expect(sources.imagery.url).toBe('pmtiles://imagery.pmtiles');
  });

  it('a live url: source (refresh:) still emits a loadable source', async () => {
    const { sources } = await emitValid(`sources:
  live:
    type: geojson
    url: https://example.com/live.geojson
    refreshInterval: 5000
layers:
  - { id: l, type: circle, source: live }
`);
    expect(sources.live).toEqual({ type: 'geojson', data: 'https://example.com/live.geojson' });
  });
});
