/**
 * `mlym breaks` (R14, KTD13): breaks for a file the browser cannot classify
 * by view, computed from the whole local file with core's own math, printed
 * as a block that pastes under `classify:`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { ClassifySchema, computeBreaks, decodeGeoParquet } from '@maplibre-yaml/core';
import { fileBreaks, formatBreaks, BreaksError } from '../src/commands/breaks';
import { EXIT_CODES } from '../src/types';

const execAsync = promisify(exec);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../../..');
const CLI = join(HERE, '../dist/cli.js');
const FIXTURES = join(REPO, 'docs/public/gallery-assets/cloud-native');
const PARQUET = join(FIXTURES, 'districts.parquet');
const FGB = join(FIXTURES, 'districts.fgb');

type FC = { type: 'FeatureCollection'; features: { type: 'Feature'; properties: Record<string, unknown>; geometry: unknown }[] };

let dir: string;
let districts: FC;
let GEOJSON: string;
/** The districts' populations, ascending: what computeBreaks is handed. */
let populations: number[];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mlym-breaks-'));
  districts = (await decodeGeoParquet(new Uint8Array(readFileSync(PARQUET)), PARQUET)) as FC;
  populations = districts.features.map((f) => f.properties.population as number).sort((a, b) => a - b);
  GEOJSON = join(dir, 'districts.geojson');
  await writeFile(GEOJSON, JSON.stringify(districts));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The error a call rejects with (fails the test if it resolves). */
async function failure(promise: Promise<unknown>): Promise<BreaksError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BreaksError);
    return error as BreaksError;
  }
  throw new Error('expected the call to fail');
}

describe('breaks: core math on the districts fixture', () => {
  it('population is INT64 in the GeoParquet, read as numbers', () => {
    expect(populations).toHaveLength(48);
    expect(populations.every((v) => typeof v === 'number' && Number.isInteger(v))).toBe(true);
  });

  for (const method of ['quantile', 'equal', 'jenks'] as const) {
    it(`${method}: the breaks are core's computeBreaks on the same data`, async () => {
      const report = await fileBreaks(PARQUET, { field: 'population', method, classes: 5 });
      expect(report.breaks).toEqual(computeBreaks(method, populations, 5));
      expect(report.breaks.length).toBeGreaterThan(0);
      expect(report.min).toBe(populations[0]);
      expect(report.max).toBe(populations[populations.length - 1]);
      expect(report.count).toBe(48);
      expect(report.noData).toBe(0);
    });
  }

  it('defaults to quantile and 5 classes, as classify: does', async () => {
    const report = await fileBreaks(PARQUET, { field: 'population' });
    expect(report.method).toBe('quantile');
    expect(report.classes).toBe(5);
    expect(report.breaks).toEqual(computeBreaks('quantile', populations, 5));
  });

  it('accepts a method in another case, as classify: does', async () => {
    const report = await fileBreaks(PARQUET, { field: 'population', method: 'Jenks', classes: 4 });
    expect(report.method).toBe('jenks');
    expect(report.breaks).toEqual(computeBreaks('jenks', populations, 4));
  });
});

describe('breaks: every input format', () => {
  it('GeoParquet, FlatGeobuf and GeoJSON give the same breaks for the same data', async () => {
    const options = { field: 'population', method: 'jenks', classes: 5 };
    const [pq, fgb, gj] = await Promise.all([
      fileBreaks(PARQUET, options),
      fileBreaks(FGB, options),
      fileBreaks(GEOJSON, options),
    ]);
    expect(pq.format).toBe('geoparquet');
    expect(fgb.format).toBe('flatgeobuf');
    expect(gj.format).toBe('geojson');
    expect(fgb.breaks).toEqual(pq.breaks);
    expect(gj.breaks).toEqual(pq.breaks);
    expect([fgb.min, fgb.max]).toEqual([pq.min, pq.max]);
  });

  it('a .json file holding a FeatureCollection is read as GeoJSON', async () => {
    const path = join(dir, 'districts.json');
    await writeFile(path, JSON.stringify(districts));
    const report = await fileBreaks(path, { field: 'population', method: 'equal', classes: 3 });
    expect(report.breaks).toEqual(computeBreaks('equal', populations, 3));
  });
});

describe('breaks: the printed block pastes under classify:', () => {
  it('a comment with the field, method, classes and range, then breaks: [...]', async () => {
    const report = await fileBreaks(PARQUET, { field: 'population', method: 'quantile', classes: 5 });
    const text = formatBreaks(report);
    const lines = text.trimEnd().split('\n');
    expect(lines.slice(0, -1).every((l) => l.startsWith('#'))).toBe(true);
    expect(text).toMatch(/population/);
    expect(text).toMatch(/quantile/);
    expect(text).toMatch(/5 classes/);
    expect(text).toContain(String(report.min));
    expect(text).toContain(String(report.max));
    expect(lines[lines.length - 1]).toMatch(/^breaks: \[.*\]$/);

    // As YAML it is exactly { breaks }, and with a field it is a valid classify: block.
    const parsed = parseYaml(text) as { breaks: number[] };
    expect(parsed).toEqual({ breaks: report.breaks });
    expect(ClassifySchema.safeParse({ field: 'population', ...parsed }).success).toBe(true);
  });

  it('says so when ties leave fewer classes than asked', async () => {
    const path = join(dir, 'ties.geojson');
    const values = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3];
    await writeFile(
      path,
      JSON.stringify({
        type: 'FeatureCollection',
        features: values.map((v) => ({ type: 'Feature', properties: { v }, geometry: null })),
      }),
    );
    const report = await fileBreaks(path, { field: 'v', method: 'quantile', classes: 5 });
    expect(report.breaks.length + 1).toBeLessThan(5);
    expect(formatBreaks(report)).toMatch(/fewer|ties/i);
  });
});

describe('breaks: no data and edge values', () => {
  it('nulls and missing values count as no data and are left out of the breaks', async () => {
    const path = join(dir, 'nulls.geojson');
    const props = [{ v: 1 }, { v: null }, { v: 5 }, {}, { v: '' }, { v: 9 }, { v: '12' }];
    await writeFile(
      path,
      JSON.stringify({
        type: 'FeatureCollection',
        features: props.map((p) => ({ type: 'Feature', properties: p, geometry: null })),
      }),
    );
    const report = await fileBreaks(path, { field: 'v', method: 'equal', classes: 2 });
    expect(report.count).toBe(7);
    expect(report.noData).toBe(3);
    expect([report.min, report.max]).toEqual([1, 12]);
    expect(report.breaks).toEqual(computeBreaks('equal', [1, 5, 9, 12], 2));
    expect(formatBreaks(report)).toMatch(/3 .*no data/);
  });

  it('a field every feature leaves empty exits 1', async () => {
    const path = join(dir, 'empty-field.geojson');
    await writeFile(
      path,
      JSON.stringify({
        type: 'FeatureCollection',
        features: [{ v: null }, { v: null }].map((p) => ({ type: 'Feature', properties: p, geometry: null })),
      }),
    );
    const error = await failure(fileBreaks(path, { field: 'v' }));
    expect(error.exitCode).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(error.message).toMatch(/no values|no data/i);
  });

  it('normalize: divides by another field, as classify: does', async () => {
    const path = join(dir, 'rates.geojson');
    const rows = [
      { cases: 10, pop: 1000 },
      { cases: 30, pop: 1000 },
      { cases: 5, pop: 0 },
      { cases: 80, pop: 2000 },
    ];
    await writeFile(
      path,
      JSON.stringify({
        type: 'FeatureCollection',
        features: rows.map((p) => ({ type: 'Feature', properties: p, geometry: null })),
      }),
    );
    const report = await fileBreaks(path, { field: 'cases', normalize: 'pop', multiply: 1000, method: 'equal', classes: 2 });
    expect(report.noData).toBe(1);
    expect([report.min, report.max]).toEqual([10, 40]);
    expect(report.breaks).toEqual(computeBreaks('equal', [10, 30, 40], 2));
    expect(formatBreaks(report)).toMatch(/cases.*pop/);
  });
});

describe('breaks: refusals', () => {
  it('--classes outside 2-12 exits 1', async () => {
    for (const classes of [1, 13, 2.5]) {
      const error = await failure(fileBreaks(PARQUET, { field: 'population', classes }));
      expect(error.exitCode).toBe(EXIT_CODES.VALIDATION_ERROR);
      expect(error.message).toMatch(/--classes/);
      expect(error.message).toMatch(/2.*12/);
    }
  });

  it('an unknown --method exits 1 with core\'s did-you-mean', async () => {
    const error = await failure(fileBreaks(PARQUET, { field: 'population', method: 'quantiles' }));
    expect(error.exitCode).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(error.message).toMatch(/Did you mean "quantile"/);
  });

  it('a string field exits 1, naming the type and suggesting categories', async () => {
    const error = await failure(fileBreaks(PARQUET, { field: 'category' }));
    expect(error.exitCode).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(error.message).toMatch(/string/);
    expect(error.message).toMatch(/categories/);
  });

  it('a missing field exits 1, naming the fields the file has', async () => {
    const error = await failure(fileBreaks(FGB, { field: 'Population' }));
    expect(error.exitCode).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(error.message).toMatch(/Population/);
    expect(error.message).toMatch(/population/);
  });

  it('no --field exits 1', async () => {
    const error = await failure(fileBreaks(PARQUET, { field: '' }));
    expect(error.exitCode).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(error.message).toMatch(/--field/);
  });

  it('a missing file exits 2', async () => {
    const error = await failure(fileBreaks(join(dir, 'nope.parquet'), { field: 'population' }));
    expect(error.exitCode).toBe(EXIT_CODES.FILE_NOT_FOUND);
  });

  it('a PMTiles archive exits 1: tiles are not the whole dataset', async () => {
    const error = await failure(fileBreaks(join(FIXTURES, 'districts.pmtiles'), { field: 'population' }));
    expect(error.exitCode).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(error.message).toMatch(/PMTiles/);
  });

  it('a file that is not what its extension says exits 1', async () => {
    const error = await failure(fileBreaks(join(FIXTURES, 'not-really.parquet'), { field: 'population' }));
    expect(error.exitCode).toBe(EXIT_CODES.VALIDATION_ERROR);
  });

  it('JSON that is not GeoJSON features exits 1', async () => {
    const path = join(dir, 'not-geojson.json');
    await writeFile(path, JSON.stringify({ hello: 'world' }));
    const error = await failure(fileBreaks(path, { field: 'population' }));
    expect(error.exitCode).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(error.message).toMatch(/GeoJSON/);
  });
});

// Requires the CLI to be built (`pnpm --filter @maplibre-yaml/cli build`), like test/integration.
describe('breaks: the command', () => {
  const run = async (args: string) => {
    try {
      const { stdout, stderr } = await execAsync(`node "${CLI}" breaks ${args}`);
      return { code: 0, stdout, stderr };
    } catch (error) {
      const e = error as { code: number; stdout: string; stderr: string };
      return { code: e.code, stdout: e.stdout, stderr: e.stderr };
    }
  };

  it('prints the block on stdout and exits 0', async () => {
    const { code, stdout } = await run(`"${PARQUET}" --field population --method jenks --classes 5`);
    expect(code).toBe(0);
    expect(parseYaml(stdout)).toEqual({ breaks: computeBreaks('jenks', populations, 5) });
  });

  it('-f json prints one object', async () => {
    const { code, stdout } = await run(`"${FGB}" --field population -f json`);
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report).toMatchObject({ success: true, field: 'population', method: 'quantile', classes: 5 });
    expect(report.breaks).toEqual(computeBreaks('quantile', populations, 5));
  });

  it('exit codes: 1 for a bad flag or a string field, 2 for a missing file', async () => {
    expect((await run(`"${PARQUET}" --field population --classes 20`)).code).toBe(EXIT_CODES.VALIDATION_ERROR);
    const text = await run(`"${PARQUET}" --field name`);
    expect(text.code).toBe(EXIT_CODES.VALIDATION_ERROR);
    expect(text.stderr).toMatch(/categories/);
    expect((await run(`"${join(dir, 'nope.fgb')}" --field population`)).code).toBe(EXIT_CODES.FILE_NOT_FOUND);
    expect((await run(`--field population`)).code).toBe(EXIT_CODES.VALIDATION_ERROR);
  });
});
