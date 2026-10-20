/**
 * `mlym emit` with cloud-native sources (0.9, ml-cnv): a FlatGeobuf or GeoParquet file is
 * read and inlined as GeoJSON (style.json can't carry a decoder); a file
 * that can't be read leaves the source empty, reported lossy, so --strict
 * refuses. PMTiles export as pmtiles:// URLs.
 */

import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { YAMLParser, EmitError } from '@maplibre-yaml/core';
import { emitStyle } from '../src/commands/emit';
import { resolveDataRefs } from '../src/lib/data-refs';
import { createDataLoader } from '../src/lib/data-loader';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIXTURES = join(REPO, 'docs/public/gallery-assets/cloud-native');
/** A document path in the fixtures folder (the file need not exist). */
const DOC_PATH = join(FIXTURES, 'map.yaml');

const parse = (yaml: string) => {
  const result = YAMLParser.safeParseMapBlock(yaml);
  if (!result.success) throw new Error(JSON.stringify(result.errors));
  return result.data;
};

const doc = (url: string) => `
type: map
id: cn
config:
  center: [10.2, 42.15]
  zoom: 10
sources:
  districts:
    type: geojson
    url: ${url}
  tiles:
    type: vector
    url: districts.pmtiles
layers:
  - { id: d, type: fill, source: districts }
  - { id: t, type: line, source: tiles, source-layer: districts }
`;

describe('emit: FlatGeobuf → inline GeoJSON', () => {
  it('reads the file beside the document and inlines every feature', async () => {
    const { style, warnings } = await emitStyle(parse(doc('districts.fgb')), 'strict', { trust: 'untrusted' }, {
      documentPath: DOC_PATH,
    });
    const sources = style.sources as Record<string, Record<string, unknown>>;
    const data = sources.districts.data as { features: unknown[] };
    expect(data.features).toHaveLength(48);
    expect(sources.districts.url).toBeUndefined();
    expect(sources.tiles.url).toBe('pmtiles://districts.pmtiles');
    expect(warnings.some((w) => w.kind === 'lossy')).toBe(false);
  });

  it('an unreadable file: empty source, lossy — and --strict refuses', async () => {
    const block = parse(doc('missing.fgb'));
    const { style, warnings } = await emitStyle(block, 'with-fallbacks', { trust: 'untrusted' }, {
      documentPath: DOC_PATH,
    });
    const sources = style.sources as Record<string, Record<string, unknown>>;
    expect((sources.districts.data as { features: unknown[] }).features).toEqual([]);
    expect(warnings).toContainEqual(
      expect.objectContaining({ kind: 'lossy', construct: 'format.flatgeobuf', path: 'sources.districts.data' })
    );
    await expect(
      emitStyle(block, 'strict', { trust: 'untrusted' }, { documentPath: DOC_PATH })
    ).rejects.toThrow(EmitError);
  });

  it('http(s) URLs are fetched (reader injectable)', async () => {
    const seen: string[] = [];
    const { readFileSync } = await import('node:fs');
    const { resolved, warnings } = await resolveDataRefs(
      [{ source: 's', url: 'https://example.org/d.fgb', format: 'flatgeobuf' }],
      {
        reader: async (url) => {
          seen.push(url);
          return new Uint8Array(readFileSync(join(FIXTURES, 'districts.fgb')));
        },
      }
    );
    expect(seen).toEqual(['https://example.org/d.fgb']);
    expect((resolved[0]!.data as { features: unknown[] }).features).toHaveLength(48);
    expect(warnings).toEqual([]);
  });

  it('a wrong-CRS file is lossy with the plain reason', async () => {
    const { warnings } = await resolveDataRefs(
      [{ source: 's', url: 'districts-3857.fgb', format: 'flatgeobuf' }],
      { documentPath: DOC_PATH }
    );
    expect(warnings[0]!.kind).toBe('lossy');
    expect(warnings[0]!.message).toContain('is in EPSG:3857');
  });

  it('classify: data loading decodes a FlatGeobuf file too (same path rules)', async () => {
    const data = (await createDataLoader(DOC_PATH)('districts.fgb')) as { features: unknown[] };
    expect(data.features).toHaveLength(48);
  });

  it('a FlatGeobuf source with classify: emits (breaks baked from the decoded features)', async () => {
    const yaml = `
type: map
id: cn
config:
  center: [10.2, 42.15]
  zoom: 10
sources:
  districts:
    type: geojson
    url: districts.fgb
layers:
  - id: d
    type: fill
    source: districts
    classify:
      field: population
      method: quantile
      classes: 3
      palette: Blues
`;
    const { style } = await emitStyle(parse(yaml), 'with-fallbacks', { trust: 'untrusted' }, {
      loadData: createDataLoader(DOC_PATH),
      documentPath: DOC_PATH,
    });
    const layer = (style.layers as Record<string, unknown>[]).find((l) => l.id === 'd')!;
    expect(JSON.stringify(layer.paint)).toContain('population');
  });

  it('classify: format: flatgeobuf on an extensionless URL is decoded, not read as JSON (ml-aot.79)', async () => {
    const { mkdtempSync, copyFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'mlym-fgb-'));
    try {
      copyFileSync(join(FIXTURES, 'districts.fgb'), join(dir, 'districts'));
      const yaml = `
type: map
id: cn
config:
  center: [10.2, 42.15]
  zoom: 10
sources:
  districts:
    type: geojson
    url: districts
    format: flatgeobuf
layers:
  - id: d
    type: fill
    source: districts
    classify: { field: population, method: quantile, classes: 3, palette: Blues }
`;
      const docPath = join(dir, 'map.yaml');
      const { style } = await emitStyle(parse(yaml), 'with-fallbacks', { trust: 'untrusted' }, {
        loadData: createDataLoader(docPath),
        documentPath: docPath,
      });
      const layer = (style.layers as Record<string, unknown>[]).find((l) => l.id === 'd')!;
      expect(JSON.stringify(layer.paint)).toContain('"step"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('emit: a Protomaps basemap from a .pmtiles file (ml-cnv.7)', () => {
  const yaml = `
type: map
id: pm
config:
  center: [-73.99, 40.70]
  zoom: 14
  mapStyle:
    pmtiles: data/nyc.pmtiles
    flavor: dark
    lang: es
layers:
  - id: dot
    type: circle
    source: { type: geojson, data: { type: Point, coordinates: [-73.99, 40.7] } }
`;

  it('writes the generated style: layers expanded, the file as pmtiles://, the document on top', async () => {
    const { validateStyleMin } = await import('@maplibre/maplibre-gl-style-spec');
    const { style, warnings } = await emitStyle(parse(yaml), 'strict', { trust: 'untrusted' }, {
      documentPath: DOC_PATH,
    });
    const sources = style.sources as Record<string, Record<string, unknown>>;
    expect(sources.protomaps).toMatchObject({ type: 'vector', url: 'pmtiles://data/nyc.pmtiles' });
    expect(String(sources.protomaps.attribution)).toMatch(/OpenStreetMap/);
    expect(style.sprite).toBe('https://protomaps.github.io/basemaps-assets/sprites/v4/dark');
    expect(style.glyphs).toBe('https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf');
    const ids = (style.layers as Array<{ id: string }>).map((l) => l.id);
    expect(ids[0]).toBe('background');
    expect(ids.length).toBeGreaterThan(50);
    expect(ids[ids.length - 1]).toBe('dot');
    expect(JSON.stringify(style.layers)).toContain('name:es');
    // Same note as any exported PMTiles source, plus the relative-path caveat.
    const note = warnings.find((w) => w.path === 'basemap.pmtiles');
    expect(note).toMatchObject({ kind: 'contract', construct: 'format.pmtiles' });
    expect(note!.message).toContain('register it with addProtocol');
    expect(note!.message).toContain('resolves against the page that loads the style');
    expect(validateStyleMin(style as never)).toEqual([]);
  });
});

describe('emit: GeoParquet → inline GeoJSON', () => {
  it('reads the file beside the document and inlines every feature, every column', async () => {
    const { style, warnings } = await emitStyle(parse(doc('districts.parquet')), 'strict', { trust: 'untrusted' }, {
      documentPath: DOC_PATH,
    });
    const sources = style.sources as Record<string, Record<string, unknown>>;
    const data = sources.districts.data as { features: { properties: Record<string, unknown> }[] };
    expect(data.features).toHaveLength(48);
    expect(Object.keys(data.features[0]!.properties).sort()).toEqual(['category', 'name', 'population']);
    expect(sources.districts.url).toBeUndefined();
    expect(warnings.some((w) => w.kind === 'lossy')).toBe(false);
    expect(warnings).toContainEqual(
      expect.objectContaining({ kind: 'contract', construct: 'format.geoparquet' })
    );
  });

  it("an author's columns: is what the snapshot carries", async () => {
    const yaml = `
type: map
id: cn
config:
  center: [10.2, 42.15]
  zoom: 10
sources:
  districts:
    type: geojson
    url: districts.parquet
    columns: [name]
layers:
  - { id: d, type: fill, source: districts }
`;
    const { style } = await emitStyle(parse(yaml), 'strict', { trust: 'untrusted' }, { documentPath: DOC_PATH });
    const data = (style.sources as Record<string, Record<string, unknown>>).districts.data as {
      features: { properties: Record<string, unknown> }[];
    };
    expect(Object.keys(data.features[0]!.properties)).toEqual(['name']);
    expect(JSON.stringify(style)).not.toContain('"columns"');
  });

  it('an unreadable file (GeoArrow geometry): empty source, lossy with the plain reason — --strict refuses', async () => {
    const block = parse(doc('points-geoarrow.parquet'));
    const { warnings } = await emitStyle(block, 'with-fallbacks', { trust: 'untrusted' }, {
      documentPath: DOC_PATH,
    });
    const lossy = warnings.find((w) => w.kind === 'lossy' && w.construct === 'format.geoparquet');
    expect(lossy?.message).toContain('stores its geometry as GeoArrow');
    await expect(
      emitStyle(block, 'strict', { trust: 'untrusted' }, { documentPath: DOC_PATH })
    ).rejects.toThrow(EmitError);
  });

  it('classify: data loading decodes a GeoParquet file too (same path rules)', async () => {
    const data = (await createDataLoader(DOC_PATH)('districts.parquet')) as { features: unknown[] };
    expect(data.features).toHaveLength(48);
    const zstd = (await createDataLoader(DOC_PATH)('points-zstd.parquet')) as { features: unknown[] };
    expect(zstd.features).toHaveLength(400);
  });

  it('a GeoParquet source with classify: emits (breaks baked from the decoded features)', async () => {
    const yaml = `
type: map
id: cn
config:
  center: [10.2, 42.15]
  zoom: 10
sources:
  districts:
    type: geojson
    url: districts.parquet
layers:
  - id: d
    type: fill
    source: districts
    classify: { field: population, method: quantile, classes: 3, palette: Blues }
`;
    const { style } = await emitStyle(parse(yaml), 'with-fallbacks', { trust: 'untrusted' }, {
      loadData: createDataLoader(DOC_PATH),
      documentPath: DOC_PATH,
    });
    const layer = (style.layers as Record<string, unknown>[]).find((l) => l.id === 'd')!;
    expect(JSON.stringify(layer.paint)).toContain('"step"');
  });
});
