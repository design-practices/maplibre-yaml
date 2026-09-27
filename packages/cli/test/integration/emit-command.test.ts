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

  const MARKERS_DOC = `type: map
id: pins
config:
  center: [-73.98, 40.75]
  zoom: 12
markers:
  - at: [-73.985, 40.748]
    color: "#e63946"
  - at: [-73.97, 40.76]
`;

  it('refuses a markers document under --strict, naming the fallback flag', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'pins.yaml');
    await writeFile(doc, MARKERS_DOC);

    const error = await execAsync(`node "${CLI}" emit "${doc}" --strict`).then(
      () => null,
      (e) => e,
    );
    expect(error).toMatchObject({ code: 1 });
    expect(String(error.stderr)).toMatch(/--with-fallbacks/);
  });

  it('requires --out and --sprite-base for a markers doc under --with-fallbacks', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'pins.yaml');
    await writeFile(doc, MARKERS_DOC);

    const error = await execAsync(
      `node "${CLI}" emit "${doc}" --with-fallbacks`,
    ).then(() => null, (e) => e);
    expect(error).toMatchObject({ code: 1 });
    expect(String(error.stderr)).toMatch(/--out/);
  });

  it('lowers markers to a symbol layer and writes the sprite files', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'pins.yaml');
    const out = join(dir, 'style.json');
    await writeFile(doc, MARKERS_DOC);

    await execAsync(
      `node "${CLI}" emit "${doc}" --with-fallbacks --out "${out}" --sprite-base https://maps.example.com/pins`,
    );
    const style = JSON.parse(await readFile(out, 'utf-8'));
    const markerLayer = style.layers.find((l: any) => l.id === 'mlym-markers');
    expect(markerLayer.type).toBe('symbol');
    expect(style.sources['mlym-markers'].data.features).toHaveLength(2);
    expect(style.sprite).toEqual([
      { id: 'mlym', url: 'https://maps.example.com/pins/mlym' },
    ]);
    // The four sprite files land beside the style (KTD3: cli rasterizes).
    for (const name of ['mlym.json', 'mlym.png', 'mlym@2x.json', 'mlym@2x.png']) {
      expect(await readFile(join(dir, name))).toBeDefined();
    }
  });

  it('fetches images: at emit time into the sprite, refs rewritten to mlym: (U6)', async () => {
    const { createServer } = await import('node:http');
    const { once } = await import('node:events');
    const sharp = (await import('sharp')).default;
    const png = await sharp({
      create: { width: 6, height: 6, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(png);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;

    try {
      const dir = await mkdir();
      const doc = join(dir, 'iconic.yaml');
      const out = join(dir, 'style.json');
      await writeFile(
        doc,
        `type: map
id: iconic
config:
  center: [0, 0]
  zoom: 2
images:
  poi: http://127.0.0.1:${port}/poi.png
sources:
  pts:
    type: geojson
    data: { type: FeatureCollection, features: [] }
layers:
  - id: spots
    type: symbol
    source: pts
    layout: { icon-image: poi }
`,
      );

      // images: compiles fully — --strict accepts it (with the sprite args).
      await execAsync(
        `node "${CLI}" emit "${doc}" --strict --out "${out}" --sprite-base https://maps.example.com/iconic`,
      );
      const style = JSON.parse(await readFile(out, 'utf-8'));
      expect(style.layers[0].layout['icon-image']).toBe('mlym:poi');
      expect(style.sprite).toEqual([
        { id: 'mlym', url: 'https://maps.example.com/iconic/mlym' },
      ]);
      const index = JSON.parse(await readFile(join(dir, 'mlym.json'), 'utf-8'));
      expect(index['poi']).toMatchObject({ width: 6, height: 6 });
    } finally {
      server.close();
    }
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
