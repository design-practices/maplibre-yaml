import { describe, it, expect, afterAll } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { parse as parseYAML } from 'yaml';

const execAsync = promisify(exec);
const CLI = join(process.cwd(), 'dist/cli.js');
const FIXTURES = join(process.cwd(), '../core/tests/fixtures/toml');

/** Run the CLI; a non-zero exit resolves too, with its code. */
async function mlym(args: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(`node "${CLI}" ${args}`, { env: { ...process.env, NO_COLOR: '1' } });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const exists = (path: string) => stat(path).then(() => true, () => false);

// Requires the CLI and @maplibre-yaml/core to be built (U5, KTD10).
describe('convert command (integration)', () => {
  const tmpDirs: string[] = [];
  const mkdir = async () => {
    const d = await mkdtemp(join(tmpdir(), 'convert-'));
    tmpDirs.push(d);
    return d;
  };
  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  const STORY = (exit: string) => `type: scrollytelling
id: s
config:
  mapStyle: "https://demotiles.maplibre.org/style.json"
  center: [0, 0]
  zoom: 1
layers:
  - id: dots
    type: circle
    source: { type: geojson, data: { type: FeatureCollection, features: [] } }
chapters:
  - id: one
    title: One
    center: [0, 0]
    zoom: 1
    onChapterExit:
      - action: setFilter
        layer: dots
${exit}`;

  it('AE5: leaves a setFilter filter: null out of TOML, reports it on stderr, and exits 0', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'story.yaml');
    await writeFile(doc, STORY('        filter: null\n'));

    const { code, stdout, stderr } = await mlym(`convert "${doc}" --to toml`);
    expect(code).toBe(0);
    // With its filter left out, the action fits on its line.
    expect(stdout).toContain('onChapterExit = [{ action = "setFilter", layer = "dots" }]\n');
    expect(stdout).not.toMatch(/filter/);
    expect(stderr).toContain('chapters.0.onChapterExit.0.filter: null dropped');
  });

  it('AE5: a null inside an expression fails, naming its path, exits 1 and writes nothing', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'story.yaml');
    const out = join(dir, 'story.toml');
    await writeFile(doc, STORY('        filter: ["==", ["get", "kind"], null]\n'));

    const { code, stdout, stderr } = await mlym(`convert "${doc}" --to toml --out "${out}"`);
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('chapters.0.onChapterExit.0.filter.2: TOML has no null');
    expect(stderr).toContain('(19:41)');
    expect(await exists(out)).toBe(false);
  });

  it('writes the quick-start map as JSON in about 40 lines, expressions inline', async () => {
    const { code, stdout, stderr } = await mlym(`convert "${join(FIXTURES, 'quick-start.yaml')}" --to json`);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout.trimEnd().split('\n').length).toBeLessThanOrEqual(45);
    expect(stdout).toContain('"interpolate", ["linear"], ["get", "mag"], 1, 2, 7, 20');
    expect(JSON.parse(stdout)).toEqual(parseYAML(await readFile(join(FIXTURES, 'quick-start.yaml'), 'utf8')));
  });

  it('converts TOML to YAML through --out, keeping the data', async () => {
    const dir = await mkdir();
    const out = join(dir, 'nested/story.yaml');
    const { code, stdout } = await mlym(`convert "${join(FIXTURES, 'story.toml')}" --to yaml -o "${out}"`);
    expect(code).toBe(0);
    // The document goes to the file, not stdout.
    expect(stdout).not.toContain('scrollytelling');
    const written = await readFile(out, 'utf8');
    expect(written.split('\n')[0]).toBe(
      '# yaml-language-server: $schema=https://docs.maplibre-yaml.org/schema/latest/scrollytelling.schema.json'
    );
    const original = parseYAML(await readFile(join(FIXTURES, 'story.yaml'), 'utf8'));
    delete original.chapters[1].onChapterExit[0].filter; // TOML has no null
    expect(parseYAML(written)).toEqual(original);
  });

  it('reports comments with their lines; --strict makes one loss exit 1 and write nothing', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'map.yaml');
    const out = join(dir, 'map.json');
    const text = (await readFile(join(FIXTURES, 'quick-start.yaml'), 'utf8')).replace('zoom: 1', 'zoom: 1 # whole world');
    await writeFile(doc, text);

    const loose = await mlym(`convert "${doc}" --to json`);
    expect(loose.code).toBe(0);
    expect(loose.stderr).toContain('the comment on line 5 is dropped: # whole world');
    expect(JSON.parse(loose.stdout).config.zoom).toBe(1);

    const strict = await mlym(`convert "${doc}" --to json --strict --out "${out}"`);
    expect(strict.code).toBe(1);
    expect(strict.stderr).toContain('--strict');
    expect(strict.stdout).toBe('');
    expect(await exists(out)).toBe(false);
  });

  it('refuses --out naming the input file, and leaves it untouched', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'map.yaml');
    const text = await readFile(join(FIXTURES, 'quick-start.yaml'), 'utf8');
    await writeFile(doc, text);

    const { code, stderr } = await mlym(`convert "${doc}" --to yaml --out "${join(dir, '.', 'map.yaml')}"`);
    expect(code).toBe(1);
    expect(stderr).toContain('--out names the input file');
    expect(await readFile(doc, 'utf8')).toBe(text);
  });

  it('reprints a document in its own format', async () => {
    const { code, stdout } = await mlym(`convert "${join(FIXTURES, 'locale.toml')}" --to toml`);
    expect(code).toBe(0);
    expect(stdout).toContain('"Popup.Close" = "Cerrar"');
  });

  it('refuses input that fails validation: exit 1, the errors on stderr, nothing written', async () => {
    const dir = await mkdir();
    const out = join(dir, 'out.toml');
    const { code, stdout, stderr } = await mlym(`convert "${join(FIXTURES, 'quick-start-planted.yaml')}" --to toml --out "${out}"`);
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('is not a valid document; nothing was written');
    expect(stderr).toMatch(/config\.zoom: .*\(5:9\)/);
    expect(await exists(out)).toBe(false);
  });

  it('refuses a syntax error with exit 1', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'bad.toml');
    await writeFile(doc, 'type = "map"\nid = \n');
    const { code, stderr } = await mlym(`convert "${doc}" --to yaml`);
    expect(code).toBe(1);
    expect(stderr).toContain('TOML syntax error');
  });

  it('lets warnings through', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'map.json');
    // An unknown key is a warning, not an error.
    await writeFile(doc, '{"type": "map", "id": "m", "config": {"center": [0, 0], "zoom": 2, "mapStyle": "https://demotiles.maplibre.org/style.json"}, "layers": [], "colour": "red"}');
    const { code, stdout } = await mlym(`convert "${doc}" --to yaml`);
    expect(code).toBe(0);
    expect(stdout).toContain('colour: red');
  });

  it('exits 2 for a missing file, and 1 for an unknown --to', async () => {
    const dir = await mkdir();
    const missing = await mlym(`convert "${join(dir, 'nope.yaml')}" --to json`);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('Could not read');

    const unknown = await mlym(`convert "${join(FIXTURES, 'quick-start.yaml')}" --to xml`);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('--to must be yaml, json or toml');
  });

  it('fails on inf going to JSON, naming the path', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'map.toml');
    const text = (await readFile(join(FIXTURES, 'quick-start.toml'), 'utf8')).replace('circle-opacity = 0.7', 'circle-opacity = inf');
    await writeFile(doc, text);
    const { code, stdout, stderr } = await mlym(`convert "${doc}" --to json`);
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('layers.0.paint.circle-opacity: JSON has no inf');
  });
});
