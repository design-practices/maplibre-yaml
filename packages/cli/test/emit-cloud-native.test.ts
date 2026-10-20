/**
 * `mlym emit` with cloud-native sources (0.9, ml-cnv): a FlatGeobuf file is
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
