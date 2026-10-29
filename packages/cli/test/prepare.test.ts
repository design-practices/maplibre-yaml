/**
 * `mlym prepare` (R13, F3, KTD12): look at a file's header or footer, say
 * what it is, print the one command that makes it draw well and the YAML
 * source block to paste. It reads; it never writes data.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile, open } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { YAMLParser } from '@maplibre-yaml/core';
import {
  prepareFile,
  recommend,
  formatPrepare,
  PrepareError,
  type FileFacts,
  type PrepareReport,
} from '../src/commands/prepare';
import { shellCommands } from '../src/lib/producer-commands';
// Core's own builders (the browser's hints), to prove the CLI prints the same commands.
import {
  overviewsCommand,
  pmtilesCommand,
  sortedParquetCommand,
  indexedFlatGeobufCommand,
} from '../../core/src/components/student-messages';
// …and what the CLI imports: the built core's exports (U5 removed the CLI's copies).
import * as core from '@maplibre-yaml/core';
import { EXIT_CODES } from '../src/types';

const execAsync = promisify(exec);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../../..');
const CLI = join(HERE, '../dist/cli.js');
const FIXTURES = join(REPO, 'docs/public/gallery-assets/cloud-native');
const at = (name: string) => join(FIXTURES, name);
const MB = 1024 * 1024;

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mlym-prepare-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The error a call rejects with (fails the test if it resolves). */
async function failure(promise: Promise<unknown>): Promise<PrepareError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PrepareError);
    return error as PrepareError;
  }
  throw new Error('expected the call to fail');
}

/**
 * A printed YAML block, checked the way an author would use it: pasted into
 * a map document beside a layer that draws the source, then parsed by core.
 */
function expectValidSource(yaml: string): void {
  const id = /^sources:\n {2}([^:\n]+):/.exec(yaml)?.[1];
  expect(id, `a sources: block naming one source:\n${yaml}`).toBeTruthy();
  const vector = /\n {4}type: vector\b/.test(yaml);
  const raster = /\n {4}type: raster\b/.test(yaml);
  const layer = vector
    ? `{ id: l, type: line, source: ${id}, source-layer: anything }`
    : raster
      ? `{ id: l, type: raster, source: ${id} }`
      : `{ id: l, type: circle, source: ${id} }`;
  const doc = [
    'type: map',
    'id: prepared',
    'config:',
    '  center: [10.2, 42.15]',
    '  zoom: 10',
    '  mapStyle: "https://demotiles.maplibre.org/style.json"',
    yaml.trimEnd(),
    'layers:',
    `  - ${layer}`,
    '',
  ].join('\n');
  const result = YAMLParser.safeParseMapBlock(doc);
  expect(result.success, `${doc}\n${JSON.stringify(result.errors, null, 2)}`).toBe(true);
}

/** Every command a report recommends or suggests, in order. */
const commandsOf = (report: Pick<PrepareReport, 'recommendation'>) =>
  report.recommendation.steps.flatMap((s) => s.commands);

// --- Facts as a reader would return them, for the routing table -------------

const parquetFacts = (over: Partial<Extract<FileFacts, { format: 'geoparquet' }>> = {}): FileFacts => ({
  format: 'geoparquet',
  byteLength: 40 * MB,
  rows: 120_000,
  rowGroups: 12,
  totalRows: 120_000,
  totalRowGroups: 12,
  rowsPerRowGroup: { min: 10_000, max: 10_240 },
  geometryColumn: 'geometry',
  encoding: 'WKB',
  geometryTypes: ['Point'],
  crs: 'EPSG:4326',
  lonLat: true,
  bboxColumn: 'bbox',
  spatialOrder: 'sorted',
  columns: ['name'],
  compression: ['ZSTD'],
  ...over,
});

const fgbFacts = (over: Partial<Extract<FileFacts, { format: 'flatgeobuf' }>> = {}): FileFacts => ({
  format: 'flatgeobuf',
  byteLength: 30 * MB,
  features: 120_000,
  indexed: true,
  nodeSize: 16,
  geometryType: 'Point',
  crs: 'EPSG:4326',
  lonLat: true,
  columns: ['name'],
  ...over,
});

const geojsonFacts = (over: Partial<Extract<FileFacts, { format: 'geojson' }>> = {}): FileFacts => ({
  format: 'geojson',
  byteLength: 300 * MB,
  features: 2_870_000,
  estimated: true,
  sampledBytes: 8 * MB,
  geometryTypes: ['Polygon'],
  lonLat: true,
  ...over,
});

describe('prepare: the commands are the browser hints’ commands', () => {
  it('shellCommands lifts the commands out of a hint, without the backticks', () => {
    expect(shellCommands(sortedParquetCommand('data/pluto.parquet'))).toEqual([
      'uvx --from geoparquet-io==1.7.0 gpio sort hilbert pluto.parquet pluto-hilbert.parquet --row-group-size 10000 --add-bbox',
    ]);
    expect(shellCommands(pmtilesCommand('parcels.geojson', 'geojson'))).toHaveLength(2);
  });

  it('the CLI uses core’s exported builders, and they are core’s source (a stale core build fails here)', () => {
    const cases: [string, string][] = [
      ['data/pluto.parquet', 'geoparquet'],
      ['lots.fgb', 'flatgeobuf'],
      ['parcels.geojson', 'geojson'],
    ];
    for (const [file, format] of cases) {
      expect(core.pmtilesCommand(file, format)).toBe(pmtilesCommand(file, format));
      expect(core.overviewsCommand(file, format)).toBe(overviewsCommand(file, format));
    }
    expect(core.sortedParquetCommand('data/pluto.parquet')).toBe(sortedParquetCommand('data/pluto.parquet'));
    expect(core.indexedFlatGeobufCommand('trees.fgb')).toBe(indexedFlatGeobufCommand('trees.fgb'));
    expect(core.commandStem('data/pluto.parquet', 'parquet')).toBe('pluto');
    const source = readFileSync(join(HERE, '../src/lib/producer-commands.ts'), 'utf8');
    expect(source).not.toMatch(/tylertoo|gpio|ogr2ogr/);
  });
});

describe('prepare: the size-to-format table', () => {
  it('Covers F3: a 300 MB GeoJSON (estimated) → the PMTiles route with the tylertoo command, and a type: vector block', () => {
    const rec = recommend(geojsonFacts(), 'parcels.geojson');
    expect(rec.verdict).toBe('change');
    expect(rec.route).toBe('pmtiles');
    expect(rec.steps.flatMap((s) => s.commands)).toEqual(shellCommands(pmtilesCommand('parcels.geojson', 'geojson')));
    expect(rec.steps.flatMap((s) => s.commands).join('\n')).toMatch(/tylertoo==0\.8\.0/);
    expect(rec.yaml).toMatch(/\n {4}type: vector\n {4}url: parcels\.pmtiles\n/);
    expectValidSource(rec.yaml);
  });

  it('under 50,000 features: no change needed, read whole', () => {
    const rec = recommend(geojsonFacts({ features: 4_000, estimated: false, byteLength: 2 * MB }), 'parks.geojson');
    expect(rec.verdict).toBe('no-change');
    expect(rec.steps).toEqual([]);
    expect(rec.yaml).toMatch(/type: geojson\n {4}url: parks\.geojson/);
    expect(rec.yaml).not.toMatch(/load:/);
    expectValidSource(rec.yaml);
  });

  it('a GeoJSON of 50,000–250,000 features → GeoParquet read by view (gpio convert, sorted, bbox column)', () => {
    const rec = recommend(geojsonFacts({ features: 120_000, estimated: false, byteLength: 60 * MB, geometryTypes: ['Point'] }), 'trees.geojson');
    expect(rec.route).toBe('by-view');
    expect(commandsOf({ recommendation: rec })).toEqual([
      'uvx --from geoparquet-io==1.7.0 gpio convert geoparquet trees.geojson trees.parquet --row-group-size 10000',
    ]);
    expect(rec.yaml).toMatch(/url: trees\.parquet\n {4}load: viewport/);
    expectValidSource(rec.yaml);
  });

  it('a sorted GeoParquet with a bbox column, 50,000–250,000 rows: no change needed, and the by-view YAML', () => {
    const rec = recommend(parquetFacts(), 'trees.parquet');
    expect(rec.verdict).toBe('no-change');
    expect(rec.steps).toEqual([]);
    expect(rec.yaml).toMatch(/url: trees\.parquet\n {4}load: viewport/);
    expectValidSource(rec.yaml);
  });

  it('an unsorted GeoParquet → the gpio sort command', () => {
    const rec = recommend(parquetFacts({ spatialOrder: 'unsorted' }), 'data/trees.parquet');
    expect(rec.verdict).toBe('change');
    expect(commandsOf({ recommendation: rec })).toEqual(shellCommands(sortedParquetCommand('data/trees.parquet')));
    expect(rec.yaml).toMatch(/url: trees-hilbert\.parquet\n {4}load: viewport/);
    expectValidSource(rec.yaml);
  });

  it('a GeoParquet without a bbox column, or in very large row groups → the gpio sort command too', () => {
    for (const facts of [
      parquetFacts({ bboxColumn: undefined, spatialOrder: 'unknown' }),
      parquetFacts({ rowsPerRowGroup: { min: 100_000, max: 120_000 }, rowGroups: 1 }),
    ]) {
      const rec = recommend(facts, 'trees.parquet');
      expect(commandsOf({ recommendation: rec })).toEqual(shellCommands(sortedParquetCommand('trees.parquet')));
    }
  });

  it('a FlatGeobuf without an index, 50,000–250,000 features → the ogr2ogr index command', () => {
    const rec = recommend(fgbFacts({ indexed: false, nodeSize: 0 }), 'trees.fgb');
    expect(commandsOf({ recommendation: rec })).toEqual(shellCommands(indexedFlatGeobufCommand('trees.fgb')));
    expect(rec.yaml).toMatch(/url: trees-indexed\.fgb\n {4}load: viewport/);
    expectValidSource(rec.yaml);
  });

  it('above 250,000 polygons, GeoParquet → PMTiles, with the overview file as the alternative', () => {
    const rec = recommend(parquetFacts({ rows: 856_687, geometryTypes: ['MultiPolygon'] }), 'pluto.parquet');
    expect(rec.route).toBe('pmtiles');
    expect(commandsOf({ recommendation: rec })).toEqual(shellCommands(pmtilesCommand('pluto.parquet', 'geoparquet')));
    expect(rec.alternative?.commands).toEqual(shellCommands(overviewsCommand('pluto.parquet')));
    expect(rec.notes.join('\n')).toMatch(/experimental/);
    expectValidSource(rec.yaml);
    expectValidSource(rec.alternative!.yaml);
  });

  it('above 250,000 points or lines → an overview GeoParquet file (experimental), PMTiles as the alternative', () => {
    const rec = recommend(parquetFacts({ rows: 900_000, geometryTypes: ['Point'] }), 'calls.parquet');
    expect(rec.route).toBe('overviews');
    expect(commandsOf({ recommendation: rec })).toEqual(shellCommands(overviewsCommand('calls.parquet')));
    expect(rec.yaml).toMatch(/url: calls-ov\.parquet\n {4}load: viewport/);
    expect(rec.notes.join('\n')).toMatch(/experimental/);
    expect(rec.alternative?.commands).toEqual(shellCommands(pmtilesCommand('calls.parquet', 'geoparquet')));
    expectValidSource(rec.yaml);
  });

  it('the report links the Large data guide’s section for its route (the anchors core’s hints link)', () => {
    const report = (facts: FileFacts, file: string): PrepareReport => ({ file, facts, recommendation: recommend(facts, file) });
    const more = (text: string) => text.trimEnd().split('\n').at(-1);
    expect(more(formatPrepare(report(geojsonFacts(), 'parcels.geojson')))).toBe(`More: ${core.LARGE_DATA_DOCS.pmtiles}`);
    expect(more(formatPrepare(report(parquetFacts({ rows: 900_000 }), 'calls.parquet')))).toBe(`More: ${core.LARGE_DATA_DOCS.overviews}`);
    expect(more(formatPrepare(report(parquetFacts(), 'trees.parquet')))).toBe(`More: ${core.LARGE_DATA_DOCS.whichFormat}`);
    // From GeoJSON points: converted to GeoParquet first, then the overview file — core's two commands.
    const points = recommend(geojsonFacts({ geometryTypes: ['Point'] }), 'calls.geojson');
    expect(points.route).toBe('overviews');
    expect(commandsOf({ recommendation: points })).toEqual(shellCommands(overviewsCommand('calls.geojson', 'geojson')));
  });

  it('a FlatGeobuf above 250,000 polygons → PMTiles by way of GeoParquet (core’s command)', () => {
    const rec = recommend(fgbFacts({ features: 600_000, geometryType: 'Polygon' }), 'lots.fgb');
    expect(commandsOf({ recommendation: rec })).toEqual(shellCommands(pmtilesCommand('lots.fgb', 'flatgeobuf')));
  });

  it('a projected CRS names the reprojection command first', () => {
    const rec = recommend(parquetFacts({ crs: 'EPSG:2263', lonLat: false, spatialOrder: 'sorted' }), 'trees.parquet');
    expect(rec.steps[0].commands).toEqual(['ogr2ogr -t_srs EPSG:4326 trees-4326.parquet trees.parquet']);
    // A rewrite loses the sort, so the by-view route then sorts the reprojected file.
    expect(rec.steps[1].commands).toEqual(shellCommands(sortedParquetCommand('trees-4326.parquet')));
    expectValidSource(rec.yaml);
  });

  it('a GeoArrow encoding names the WKB rewrite first', () => {
    const rec = recommend(parquetFacts({ encoding: 'point', rows: 400 }), 'pts.parquet');
    expect(rec.steps[0].commands).toEqual(['ogr2ogr -f Parquet -lco GEOMETRY_ENCODING=WKB pts-wkb.parquet pts.parquet']);
    expect(rec.yaml).toMatch(/url: pts-wkb\.parquet/);
  });
});

describe('prepare: the repo’s sample files', () => {
  it('districts.parquet (48 rows): its facts, no change needed, the whole-file YAML', async () => {
    const report = await prepareFile(at('districts.parquet'));
    expect(report.facts).toMatchObject({ format: 'geoparquet', rows: 48, bboxColumn: 'bbox', crs: 'EPSG:4326' });
    expect(report.recommendation.verdict).toBe('no-change');
    const text = formatPrepare(report);
    expect(text).toMatch(/No change needed/);
    for (const fact of [/48/, /EPSG:4326/, /bbox/, /row group/i, /sort/i, /KB|MB/]) expect(text).toMatch(fact);
    expectValidSource(report.recommendation.yaml);
  });

  it('points.parquet (sorted, bbox column, under 250,000 rows): no change needed', async () => {
    const report = await prepareFile(at('points.parquet'));
    expect(report.recommendation.verdict).toBe('no-change');
    expect(formatPrepare(report)).toMatch(/sorted/);
  });

  it('points-noindex.fgb: no index — the ogr2ogr index command', async () => {
    const report = await prepareFile(at('points-noindex.fgb'));
    const text = formatPrepare(report);
    expect(text).toMatch(/no spatial index/i);
    expect(text).toContain(shellCommands(indexedFlatGeobufCommand('points-noindex.fgb'))[0]);
    expectValidSource(report.recommendation.yaml);
  });

  for (const name of ['districts-3857.parquet', 'districts-3857.fgb']) {
    it(`${name}: the reprojection command comes first`, async () => {
      const report = await prepareFile(at(name));
      expect(report.recommendation.verdict).toBe('change');
      expect(commandsOf(report)[0]).toMatch(new RegExp(`^ogr2ogr -t_srs EPSG:4326 districts-3857-4326\\.(parquet|fgb) ${name.replace('.', '\\.')}$`));
      const text = formatPrepare(report);
      expect(text).toMatch(/EPSG:3857/);
      expect(text.indexOf('ogr2ogr -t_srs')).toBeLessThan(text.indexOf('sources:'));
      expectValidSource(report.recommendation.yaml);
    });
  }

  it('districts-native-2272.parquet (native GEOMETRY, no geo key): its CRS from the logical type, the reprojection command first (ml-37r.8)', async () => {
    const report = await prepareFile(at('districts-native-2272.parquet'));
    expect(report.facts).toMatchObject({ format: 'geoparquet', crs: 'EPSG:2272', lonLat: false });
    expect(report.recommendation.verdict).toBe('change');
    expect(commandsOf(report)[0]).toBe('ogr2ogr -t_srs EPSG:4326 districts-native-2272-4326.parquet districts-native-2272.parquet');
    expect(formatPrepare(report)).toMatch(/EPSG:2272/);
    expectValidSource(report.recommendation.yaml);
  });

  it('districts-native.parquet (native GEOMETRY, lon/lat): no reprojection', async () => {
    const report = await prepareFile(at('districts-native.parquet'));
    expect(report.facts).toMatchObject({ format: 'geoparquet', crs: 'EPSG:4326', lonLat: true });
    expect(commandsOf(report).some((c) => c.startsWith('ogr2ogr -t_srs'))).toBe(false);
  });

  it('lots-overviews.parquet: its levels, and the experimental note', async () => {
    const report = await prepareFile(at('lots-overviews.parquet'));
    const text = formatPrepare(report);
    expect(text).toMatch(/overview/i);
    for (const zoom of [10, 11, 12, 13, 14]) expect(text).toMatch(new RegExp(`z${zoom}\\b`));
    expect(text).toMatch(/256 rows/);
    expect(text).toMatch(/600 rows/);
    expect(text).toMatch(/experimental/i);
    expectValidSource(report.recommendation.yaml);
  });

  it('districts.pmtiles: already tiles — its layers, and the type: vector block', async () => {
    const report = await prepareFile(at('districts.pmtiles'));
    expect(report.facts).toMatchObject({ format: 'pmtiles', tileType: 'MVT', minZoom: 0, maxZoom: 11, layers: ['districts', 'points'] });
    expect(report.recommendation.verdict).toBe('no-change');
    expect(report.recommendation.yaml).toMatch(/type: vector\n {4}url: districts\.pmtiles/);
    expect(formatPrepare(report)).toMatch(/source-layer: districts/);
    expectValidSource(report.recommendation.yaml);
  });

  it('imagery.pmtiles: raster tiles — a type: raster block', async () => {
    const report = await prepareFile(at('imagery.pmtiles'));
    expect(report.facts).toMatchObject({ format: 'pmtiles', vector: false });
    expect(report.recommendation.yaml).toMatch(/type: raster\n/);
    expectValidSource(report.recommendation.yaml);
  });

  it('a GeoJSON file is counted in full', async () => {
    const path = join(dir, 'pts.geojson');
    await writeFile(path, JSON.stringify(points(300)));
    const report = await prepareFile(path);
    expect(report.facts).toMatchObject({ format: 'geojson', features: 300, estimated: false, geometryTypes: ['Point'], lonLat: true });
    expect(formatPrepare(report)).not.toMatch(/estimate/i);
    expectValidSource(report.recommendation.yaml);
  });

  it('a GeoJSON file over the full-parse limit is estimated from a sample, and says so', async () => {
    const path = join(dir, 'pts-big.geojson');
    await writeFile(path, JSON.stringify(points(20_000)));
    const report = await prepareFile(path, { fullParseBytes: 100_000, sampleBytes: 200_000 });
    const facts = report.facts as Extract<FileFacts, { format: 'geojson' }>;
    expect(facts.estimated).toBe(true);
    expect(facts.features).toBeGreaterThan(18_000);
    expect(facts.features).toBeLessThan(22_000);
    expect(formatPrepare(report)).toMatch(/estimate/i);
  });

  it('a GeoJSON in a projected CRS (coordinates past ±180) is flagged', async () => {
    const path = join(dir, 'projected.geojson');
    const fc = points(10, (i) => [1_112_919 + i, 5_160_620 + i]);
    await writeFile(path, JSON.stringify(fc));
    const report = await prepareFile(path);
    expect(report.facts).toMatchObject({ lonLat: false });
    expect(commandsOf(report)[0]).toBe('ogr2ogr -t_srs EPSG:4326 projected-4326.geojson projected.geojson');
  });

  it('a GeoJSON naming a projected CRS in its legacy crs member is flagged, though its coordinates look like lon/lat', async () => {
    const path = join(dir, 'legacy-2263.geojson');
    const fc = { ...points(10), crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::2263' } } };
    await writeFile(path, JSON.stringify(fc));
    const report = await prepareFile(path);
    expect(report.facts).toMatchObject({ format: 'geojson', lonLat: false, crs: 'EPSG:2263' });
    expect(commandsOf(report)[0]).toBe('ogr2ogr -t_srs EPSG:4326 legacy-2263-4326.geojson legacy-2263.geojson');
    expect(formatPrepare(report)).toMatch(/EPSG:2263/);
  });

  it('a GeoJSON whose legacy crs member names CRS84 is longitude/latitude: no reprojection', async () => {
    const path = join(dir, 'legacy-crs84.geojson');
    const fc = { ...points(10), crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } } };
    await writeFile(path, JSON.stringify(fc));
    const report = await prepareFile(path);
    expect(report.facts).toMatchObject({ format: 'geojson', lonLat: true, crs: 'EPSG:4326' });
    expect(report.recommendation.verdict).toBe('no-change');
    expect(commandsOf(report)).toEqual([]);
  });

  it('a GeoJSON over the full-parse limit with no features in its sample exits 1: the count can’t be estimated', async () => {
    const path = join(dir, 'no-features-in-sample.geojson');
    // 300 KB of whitespace before the first feature; the sample is the first 100 KB.
    await writeFile(path, `{"type":"FeatureCollection","features":[${' '.repeat(300_000)}${JSON.stringify(points(5).features[0])}]}`);
    const error = await failure(prepareFile(path, { fullParseBytes: 200_000, sampleBytes: 100_000 }));
    expect(error.exitCode).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(error.message).toMatch(/no GeoJSON features/);
  });

  describe('a FlatGeobuf whose header records no feature count (a streaming writer)', () => {
    /** points-noindex.fgb with its header's features_count set to 0, optionally padded to `size` bytes. */
    async function countless(name: string, size?: number): Promise<string> {
      const bytes = new Uint8Array(readFileSync(at('points-noindex.fgb')));
      const view = new DataView(bytes.buffer);
      const table = 12 + view.getUint32(12, true); // the size-prefixed header's root table
      const vtable = table - view.getInt32(table, true);
      const field = view.getUint16(vtable + 4 + 2 * 8, true); // Header field 8: features_count (ulong)
      expect(field).toBeGreaterThan(0);
      view.setBigUint64(table + field, 0n, true);
      const path = join(dir, name);
      await writeFile(path, bytes);
      if (size) {
        const handle = await open(path, 'r+');
        await handle.truncate(size);
        await handle.close();
      }
      return path;
    }

    it('a small one: read whole, but the report says the count is not recorded (not "0 features")', async () => {
      const report = await prepareFile(await countless('countless.fgb'));
      expect(report.facts).toMatchObject({ format: 'flatgeobuf', features: 0, indexed: false });
      const rec = report.recommendation;
      expect(rec.route).toBe('as-is');
      expect(rec.summary).not.toMatch(/\b0 (points|features)/);
      expect(rec.summary).toMatch(/count/i);
      expect(rec.notes.join('\n')).toMatch(/doesn't record how many features/);
      // Re-writing it records the count (and an index): the alternative.
      expect(rec.alternative?.commands).toEqual(shellCommands(indexedFlatGeobufCommand('countless.fgb')));
      const text = formatPrepare(report);
      expect(text).toMatch(/features\s+not recorded in the header/);
      expect(text).not.toMatch(/\b0 points\b/);
      expectValidSource(rec.yaml);
    });

    it('a large one (300 MB): routed by size — re-create it with an index and a count, read by view', async () => {
      const report = await prepareFile(await countless('countless-big.fgb', 300 * MB));
      const rec = report.recommendation;
      expect(rec.verdict).toBe('change');
      expect(rec.route).toBe('by-view');
      expect(rec.summary).not.toMatch(/No change needed/);
      expect(rec.summary).toMatch(/300 MB/);
      expect(commandsOf(report)).toEqual(shellCommands(indexedFlatGeobufCommand('countless-big.fgb')));
      expect(rec.yaml).toMatch(/url: countless-big-indexed\.fgb\n {4}load: viewport/);
      expect(rec.notes.join('\n')).toMatch(/mlym prepare/);
      expectValidSource(rec.yaml);
    });
  });
});

describe('prepare: refusals and their exit codes', () => {
  it('a missing path exits 2 (FILE_NOT_FOUND)', async () => {
    expect((await failure(prepareFile(at('missing.parquet')))).exitCode).toBe(EXIT_CODES.FILE_NOT_FOUND);
  });

  it('a folder exits 2', async () => {
    expect((await failure(prepareFile(FIXTURES))).exitCode).toBe(EXIT_CODES.FILE_NOT_FOUND);
  });

  it('plain Parquet (no geo metadata) exits 1, with core’s explanation', async () => {
    const error = await failure(prepareFile(at('plain.parquet')));
    expect(error.exitCode).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(error.message).toMatch(/not GeoParquet/);
  });

  for (const name of ['not-really.parquet', 'not-really.fgb', 'not-really.pmtiles']) {
    it(`${name} (an HTML page) exits 1`, async () => {
      expect((await failure(prepareFile(at(name)))).exitCode).toBe(EXIT_CODES.VALIDATION_ERROR);
    });
  }

  it('a file of no format it reads exits 1, naming the formats it does', async () => {
    const error = await failure(prepareFile(at('imagery.cog.tif')));
    expect(error.exitCode).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(error.message).toMatch(/GeoParquet.*FlatGeobuf.*GeoJSON.*PMTiles/);
  });

  it('JSON that is not GeoJSON exits 1', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ hello: 'world' }));
    expect((await failure(prepareFile(path))).exitCode).toBe(EXIT_CODES.VALIDATION_ERROR);
  });
});

describe('prepare: an http(s) URL is read by range requests', () => {
  let server: Server;
  let base: string;
  const requests: { url: string; range?: string }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? '/';
      requests.push({ url, ...(req.headers.range ? { range: req.headers.range } : {}) });
      if (url.startsWith('/hang/')) return; // accepts the connection, never answers
      const norange = url.startsWith('/norange/');
      if (url.startsWith('/boom/')) {
        res.writeHead(503).end('down');
        return;
      }
      let body: Uint8Array;
      try {
        body = new Uint8Array(readFileSync(at(url.replace(/^\/(norange\/)?/, ''))));
      } catch {
        res.writeHead(404).end('not found');
        return;
      }
      const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
      if (!m || norange) {
        res.writeHead(200, { 'Content-Length': body.length }).end(body);
        return;
      }
      const start = Number(m[1]);
      const end = Math.min(Number(m[2]), body.length - 1);
      res
        .writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1 })
        .end(body.subarray(start, end + 1));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  });

  it('reads a GeoParquet footer by ranges only, and the YAML keeps the URL', async () => {
    requests.length = 0;
    const report = await prepareFile(`${base}/lots-overviews.parquet`);
    expect(report.facts).toMatchObject({ format: 'geoparquet', rows: 600 });
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.range)).toBe(true);
    expect(report.recommendation.yaml).toContain(`url: ${base}/lots-overviews.parquet`);
    expectValidSource(report.recommendation.yaml);
  });

  it('reads a FlatGeobuf header by ranges', async () => {
    requests.length = 0;
    const report = await prepareFile(`${base}/points-noindex.fgb`);
    expect(report.facts).toMatchObject({ format: 'flatgeobuf', indexed: false });
    expect(requests.every((r) => r.range)).toBe(true);
  });

  it('a server without range support: exit 1, saying why and what to do (nothing downloaded whole)', async () => {
    const error = await failure(prepareFile(`${base}/norange/districts.parquet`));
    expect(error.exitCode).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(error.message).toMatch(/range requests/);
    expect(error.message).toMatch(/download/i);
  });

  it('a 404 exits 2; a 5xx exits 4', async () => {
    expect((await failure(prepareFile(`${base}/missing.parquet`))).exitCode).toBe(EXIT_CODES.FILE_NOT_FOUND);
    expect((await failure(prepareFile(`${base}/boom/x.parquet`))).exitCode).toBe(EXIT_CODES.UNKNOWN_ERROR);
  });

  it('a host that accepts the connection and never answers times out: exit 2, naming the host and the wait', async () => {
    const started = Date.now();
    const error = await failure(prepareFile(`${base}/hang/districts.parquet`, { timeoutMs: 200 }));
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(error.exitCode).toBe(EXIT_CODES.FILE_NOT_FOUND);
    expect(error.message).toContain(new URL(base).host);
    expect(error.message).toMatch(/didn't answer within 0\.2 s/);
  });

  it('an unreachable URL (nothing listening) exits 2, naming the host and why', async () => {
    const closed = createServer();
    await new Promise<void>((done) => closed.listen(0, '127.0.0.1', done));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((done) => closed.close(done));
    const error = await failure(prepareFile(`http://127.0.0.1:${port}/districts.parquet`));
    expect(error.exitCode).toBe(EXIT_CODES.FILE_NOT_FOUND);
    expect(error.message).toMatch(new RegExp(`^Could not reach http://127\\.0\\.0\\.1:${port}/districts\\.parquet \\(ECONNREFUSED\\)`));
  });

  it("a fetch that fails as undici does (TypeError with a cause) exits 2, with the cause's code", async () => {
    const failing = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' } });
    }) as typeof fetch;
    const error = await failure(prepareFile('https://data.example.invalid/lots.parquet', { fetch: failing }));
    expect(error.exitCode).toBe(EXIT_CODES.FILE_NOT_FOUND);
    expect(error.message).toBe('Could not reach https://data.example.invalid/lots.parquet (ENOTFOUND).');
  });
});

// Requires the CLI to be built (`pnpm --filter @maplibre-yaml/cli build`), like test/integration.
describe('prepare: the command', () => {
  const run = async (args: string) => {
    try {
      const { stdout, stderr } = await execAsync(`node "${CLI}" prepare ${args}`);
      return { code: 0, stdout, stderr };
    } catch (error) {
      const e = error as { code: number; stdout: string; stderr: string };
      return { code: e.code, stdout: e.stdout, stderr: e.stderr };
    }
  };

  it('Covers F3: a real 300 MB GeoJSON (sparse past its first MBs) → estimated, PMTiles via tylertoo, type: vector', async () => {
    const path = join(dir, 'parcels.geojson');
    // 10 MB of real features, then a hole to 300 MB: only the sample is read.
    const head = JSON.stringify(squares(60_000)).slice(0, -2);
    await writeFile(path, head);
    const handle = await open(path, 'r+');
    await handle.truncate(300 * MB);
    await handle.close();
    const { code, stdout } = await run(`"${path}"`);
    expect(code).toBe(0);
    expect(stdout).toMatch(/300 MB/);
    expect(stdout).toMatch(/estimate/i);
    expect(stdout).toMatch(/tylertoo==0\.8\.0/);
    expect(stdout).toContain(shellCommands(pmtilesCommand('parcels.geojson', 'geojson'))[1]);
    const yaml = stdout.slice(stdout.indexOf('sources:'));
    expect(yaml).toMatch(/type: vector\n {4}url: parcels\.pmtiles/);
    expectValidSource(yaml.slice(0, yaml.search(/\n\n|$/) + 1));
  }, 30_000);

  it('prints the facts, the advice and the YAML on stdout, and exits 0', async () => {
    const { code, stdout } = await run(`"${at('lots-overviews.parquet')}"`);
    expect(code).toBe(0);
    expect(stdout).toMatch(/lots-overviews\.parquet/);
    expect(stdout).toMatch(/sources:\n {2}lots_overviews:/);
  });

  it('-f json prints one object with the facts and the recommendation', async () => {
    const { code, stdout } = await run(`"${at('points-noindex.fgb')}" -f json`);
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report).toMatchObject({ success: true, facts: { format: 'flatgeobuf', features: 400, indexed: false } });
    expectValidSource(report.recommendation.yaml);
  });

  it('exit codes: 1 with no file argument, a bad flag or plain Parquet; 2 for a missing file', async () => {
    expect((await run('')).code).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect((await run(`"${at('districts.fgb')}" -f xml`)).code).toBe(EXIT_CODES.VALIDATION_ERROR);
    const plain = await run(`"${at('plain.parquet')}"`);
    expect(plain.code).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(plain.stderr).toMatch(/not GeoParquet/);
    expect((await run(`"${join(dir, 'nope.fgb')}"`)).code).toBe(EXIT_CODES.FILE_NOT_FOUND);
    const json = await run(`"${join(dir, 'nope.fgb')}" -f json`);
    expect(json.code).toBe(EXIT_CODES.FILE_NOT_FOUND);
    expect(JSON.parse(json.stdout)).toMatchObject({ success: false });
  });
});

// --- GeoJSON builders -------------------------------------------------------

function points(n: number, at: (i: number) => [number, number] = (i) => [10 + (i % 100) / 1000, 42 + i / 1e6]) {
  return {
    type: 'FeatureCollection',
    features: Array.from({ length: n }, (_, i) => ({
      type: 'Feature',
      properties: { id: i, name: `p${i}` },
      geometry: { type: 'Point', coordinates: at(i) },
    })),
  };
}

function squares(n: number) {
  return {
    type: 'FeatureCollection',
    features: Array.from({ length: n }, (_, i) => {
      const x = -74 + (i % 300) * 0.0005;
      const y = 40.6 + Math.floor(i / 300) * 0.0005;
      return {
        type: 'Feature',
        properties: { BBL: 1000000000 + i, landuse: i % 11 },
        geometry: {
          type: 'Polygon',
          coordinates: [[[x, y], [x + 0.0004, y], [x + 0.0004, y + 0.0004], [x, y + 0.0004], [x, y]]],
        },
      };
    }),
  };
}
