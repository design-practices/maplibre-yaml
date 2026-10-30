/**
 * ml-4cn.12: `mlym validate` warns about an integer past 2^53, which reads as
 * other digits, in YAML, JSON and TOML, in every output format.
 *
 * YAML's and JSON's are found by the CLI (core's `bigIntegerWarnings`, kept
 * off the CDN entry); TOML's by the parser itself. Each warns once.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

const execAsync = promisify(exec);
const CLI = join(process.cwd(), 'dist/cli.js');
const NO_CI = { ...process.env, CI: '' };

const BIG = '12345678901234567890';
const MESSAGE =
  `${BIG} is beyond the integers a number keeps exactly (2^53), so it reads as 12345678901234567000. ` +
  `Write it as a string ("${BIG}") if it's an id.`;
const ID_PATH = 'layers.0.source.data.features.0.id';
const STYLE = 'https://demotiles.maplibre.org/style.json';

/** The same map in each format, its feature id on line 9. */
const DOCS = {
  'map.yaml': [
    'type: map',
    'id: m',
    `config: { center: [0, 0], zoom: 2, mapStyle: "${STYLE}" }`,
    'layers:',
    '  - id: a',
    '    type: circle',
    '    source: { type: geojson, data: { type: FeatureCollection, features: [',
    '      { type: Feature,',
    `      id: ${BIG},`,
    '      geometry: { type: Point, coordinates: [0, 0] }, properties: {} } ] } }',
    '',
  ].join('\n'),
  'map.json': [
    '{',
    '  "type": "map",',
    '  "id": "m",',
    `  "config": { "center": [0, 0], "zoom": 2, "mapStyle": "${STYLE}" },`,
    '  "layers": [{ "id": "a", "type": "circle",',
    '    "source": { "type": "geojson", "data": {',
    '      "type": "FeatureCollection", "features": [{',
    '      "type": "Feature",',
    `      "id": ${BIG},`,
    '      "geometry": { "type": "Point", "coordinates": [0, 0] }, "properties": {} }] } } }]',
    '}',
    '',
  ].join('\n'),
  'map.toml': [
    'type = "map"',
    'id = "m"',
    `config = { center = [0, 0], zoom = 2, mapStyle = "${STYLE}" }`,
    '[[layers]]',
    'id = "a"',
    'type = "circle"',
    '[layers.source]',
    'type = "geojson"',
    `data = { type = "FeatureCollection", features = [{ type = "Feature", id = ${BIG}, geometry = { type = "Point", coordinates = [0, 0] }, properties = {} }] }`,
    '',
  ].join('\n'),
};
/** Where the feature id's key is written: line 9, at the key. */
const COLUMN = Object.fromEntries(
  Object.entries(DOCS).map(([name, text]) => [name, text.split('\n')[8]!.search(/"?id"?\s*[:=]\s*1/) + 1])
);

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mlym-big-int-'));
  for (const [name, text] of Object.entries(DOCS)) writeFileSync(join(dir, name), text);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const validate = (file: string, format: string) =>
  execAsync(`node "${CLI}" validate "${join(dir, file)}" --format ${format}`, { env: NO_CI });

describe('mlym validate: integers past 2^53 (ml-4cn.12)', () => {
  for (const file of Object.keys(DOCS)) {
    it(`${file}: one warning, with its path, line and column, in json`, async () => {
      const { stdout } = await validate(file, 'json');
      const parsed = JSON.parse(stdout);
      expect(parsed.valid).toBe(true);
      const found = parsed.files[0].warnings.filter((w: { message: string }) => w.message.includes('beyond the integers'));
      expect(found).toEqual([
        { path: ID_PATH, message: MESSAGE, line: 9, column: COLUMN[file], severity: 'warning' },
      ]);
    });

    it(`${file}: human, sarif and vscode output carry it once`, async () => {
      const human = (await validate(file, 'human')).stdout;
      expect(human.split('beyond the integers').length - 1).toBe(1);
      expect(human).toContain(`at line 9, column ${COLUMN[file]}`);

      const sarif = JSON.parse((await validate(file, 'sarif')).stdout);
      const results = sarif.runs[0].results.filter((r: { message: { text: string } }) => r.message.text.includes('beyond the integers'));
      expect(results).toHaveLength(1);
      expect(results[0].level).toBe('warning');
      expect(results[0].locations[0].physicalLocation.region).toMatchObject({ startLine: 9, startColumn: COLUMN[file] });

      const vscode = (await validate(file, 'vscode')).stdout;
      const lines = vscode.split('\n').filter((l) => l.includes('beyond the integers'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(`:9:${COLUMN[file]}: warning:`);
    });
  }

  it('an integer a number keeps exactly, and a quoted id, give no warning', async () => {
    const safe = join(dir, 'safe.yaml');
    writeFileSync(safe, DOCS['map.yaml'].replace(`id: ${BIG}`, 'id: 9007199254740992').replace('id: m', `id: "${BIG}"`));
    const { stdout } = await execAsync(`node "${CLI}" validate "${safe}" --format json`, { env: NO_CI });
    expect(stdout).not.toContain('beyond the integers');
  });
});
