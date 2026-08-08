import { describe, it, expect, afterAll } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

const execAsync = promisify(exec);
const CLI = join(process.cwd(), 'dist/cli.js');

// Requires the CLI and @maplibre-yaml/core to be built.
describe('emit command (integration)', () => {
  const tmpDirs: string[] = [];
  const mkdir = async () => {
    const d = await mkdtemp(join(tmpdir(), 'emit-'));
    tmpDirs.push(d);
    return d;
  };
  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  const DOC = `type: map
id: parcels
config:
  center: [-73.98, 40.75]
  zoom: 12
sources:
  parcels:
    type: geojson
    data: { type: FeatureCollection, features: [] }
layers:
  - id: fill
    type: fill
    source: parcels
    paint: { fill-color: "#8899aa" }
    interactive:
      hover: { highlight: true }
`;

  it('emits a style to stdout, with warnings kept off it', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'map.yaml');
    await writeFile(doc, DOC);

    const { stdout, stderr } = await execAsync(`node "${CLI}" emit "${doc}"`);
    const style = JSON.parse(stdout);

    expect(style.version).toBe(8);
    expect(style.layers[0].id).toBe('fill');
    expect(style.layers[0].interactive).toBeUndefined();
    // The interactive drop is a warning; it lands on stderr so stdout stays JSON.
    expect(stderr).toMatch(/interactive/);
  });

  it('writes to --out', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'map.yaml');
    const out = join(dir, 'style.json');
    await writeFile(doc, DOC);

    await execAsync(`node "${CLI}" emit "${doc}" --out "${out}"`);
    const style = JSON.parse(await readFile(out, 'utf-8'));
    expect(style.version).toBe(8);
  });

  it('fails with a non-zero exit on an invalid document', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'bad.yaml');
    await writeFile(doc, 'type: map\nid: b\nlayers:\n  - type: not-a-layer\n');

    await expect(execAsync(`node "${CLI}" emit "${doc}"`)).rejects.toMatchObject({
      code: 1,
    });
  });

  it('fails under --strict when loss changes the map', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'live.yaml');
    await writeFile(
      doc,
      `type: map
id: live
config: { center: [0, 0], zoom: 5 }
sources:
  s: { type: geojson, url: "/live.geojson", refresh: { refreshInterval: 5000 } }
layers:
  - { id: a, type: circle, source: s }
`,
    );

    await expect(execAsync(`node "${CLI}" emit "${doc}" --strict`)).rejects.toMatchObject({
      code: 1,
    });
  });

  it('rejects both mode flags at once', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'map.yaml');
    await writeFile(doc, DOC);

    await expect(
      execAsync(`node "${CLI}" emit "${doc}" --strict --with-fallbacks`),
    ).rejects.toMatchObject({ code: 1 });
  });

  it('rejects a scrollytelling document — only map compiles', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'story.yaml');
    await writeFile(doc, 'type: scrollytelling\nid: s\nchapters: []\n');

    await expect(execAsync(`node "${CLI}" emit "${doc}"`)).rejects.toMatchObject({
      code: 1,
    });
  });
});
