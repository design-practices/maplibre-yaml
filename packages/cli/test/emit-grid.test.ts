/**
 * `mlym emit` and `mlym validate` with a grid source (ml-nb1.2, U5): a grid
 * is not a MapLibre source, so emit leaves it out of `sources` and keeps its
 * declaration under `metadata["maplibre-yaml:grid-sources"]` with a contract
 * warning; `--strict` passes, and the style is spec-valid. `mlym validate`
 * attaches no warning to a well-formed grid.
 */

import { describe, it, expect } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { YAMLParser, GRID_SOURCES_METADATA_KEY } from '@maplibre-yaml/core';
import { emitStyle } from '../src/commands/emit';
import { validateFile } from '../src/lib/validator';

const FIXTURE = './test/fixtures/valid-grid.yaml';
const STASH: string = GRID_SOURCES_METADATA_KEY;

const parse = (yaml: string) => {
  const result = YAMLParser.safeParseMapBlock(yaml);
  if (!result.success) throw new Error(JSON.stringify(result.errors));
  return result.data;
};

const DOC = `
type: map
id: field
config:
  center: [0, 20]
  zoom: 2
sources:
  field:
    type: grid
    url: data/field.png
    encoding: rg-uv
    bounds: [-180, -90, 180, 90]
    range: [-30, 30]
    units: m/s
  elevation:
    type: grid
    url: data/elevation.tif
    encoding: geotiff
    bands: [0]
layers: []
`;

describe('emit: grid sources', () => {
  it('--strict succeeds: no grid in sources, declarations under metadata, contract warnings only', async () => {
    const { style, warnings } = await emitStyle(parse(DOC), 'strict', { trust: 'untrusted' });
    expect(style.sources).toEqual({});
    const stash = (style.metadata as Record<string, Record<string, Record<string, unknown>>>)[STASH];
    expect(Object.keys(stash)).toEqual(['field', 'elevation']);
    expect(stash.field).toEqual({
      type: 'grid',
      url: 'data/field.png',
      encoding: 'rg-uv',
      bounds: [-180, -90, 180, 90],
      range: [-30, 30],
      units: 'm/s',
    });
    expect(stash.elevation).toEqual({ type: 'grid', url: 'data/elevation.tif', encoding: 'geotiff', bands: [0] });
    const grid = warnings.filter((w) => w.construct === 'source.grid');
    expect(grid).toHaveLength(2);
    expect(grid.every((w) => w.kind === 'contract' && w.exportClass === 'no-export')).toBe(true);
    expect(grid[0]!.message).toMatch(/grid source `field` is not a MapLibre source/);
    expect(warnings.some((w) => w.kind === 'lossy')).toBe(false);
    expect(validateStyleMin(style as never)).toEqual([]);
  });

  it('a v2 document emits the same', async () => {
    const { style, warnings } = await emitStyle(
      parse(`
version: 2
type: map
id: field
style:
  center: [0, 20]
  zoom: 2
  sources:
    field:
      type: grid
      url: data/field.png
      encoding: scalar-r
      grid: { nx: 360, ny: 181, lo1: -180, la1: 90, dx: 1, dy: 1 }
      range: [0, 1]
      runtime: { cache: { ttl: 60000 } }
`),
      'strict',
      { trust: 'untrusted' },
    );
    expect(style.sources).toEqual({});
    const stash = (style.metadata as Record<string, Record<string, unknown>>)[STASH];
    expect(stash.field).toEqual({
      type: 'grid',
      url: 'data/field.png',
      encoding: 'scalar-r',
      grid: { nx: 360, ny: 181, lo1: -180, la1: 90, dx: 1, dy: 1 },
      range: [0, 1],
    });
    expect(warnings.every((w) => w.kind === 'contract')).toBe(true);
    expect(validateStyleMin(style as never)).toEqual([]);
  });
});

describe('validate: a well-formed grid source', () => {
  it('is valid with no warning attached to the source', async () => {
    const result = await validateFile(FIXTURE);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.filter((w) => w.path.startsWith('sources.field'))).toEqual([]);
  });
});
