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

  it('writes style.json inside a folder given as --out dist/ (not a file named dist)', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'map.yaml');
    await writeFile(doc, DOC);

    await execAsync(`node "${CLI}" emit "${doc}" --out dist/`, { cwd: dir });
    const style = JSON.parse(await readFile(join(dir, 'dist', 'style.json'), 'utf-8'));
    expect(style.version).toBe(8);
  });

  it('writes style.json inside an existing folder given without a trailing slash', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'map.yaml');
    await writeFile(doc, DOC);
    const { mkdir: mkdirp } = await import('node:fs/promises');
    await mkdirp(join(dir, 'out'));

    await execAsync(`node "${CLI}" emit "${doc}" --out out`, { cwd: dir });
    const style = JSON.parse(await readFile(join(dir, 'out', 'style.json'), 'utf-8'));
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
  s: { type: geojson, stream: { type: websocket, url: "wss://example.com/live" } }
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

  // classify: (0.9) — `method:` breaks over a url: source are baked from the
  // data at emit; the file resolves against the document like the site would.
  const CLASSIFY_DATA = {
    type: 'FeatureCollection',
    features: [5, 12, '15', 30, 50, null].map((value, i) => ({
      type: 'Feature',
      properties: { value },
      geometry: { type: 'Point', coordinates: [i, 0] },
    })),
  };
  const classifyDoc = (url: string) => `type: map
id: classed
config: { center: [0, 0], zoom: 5 }
sources:
  grid: { type: geojson, url: "${url}" }
layers:
  - id: grid
    type: circle
    source: grid
    classify: { field: value, method: quantile, classes: 3, palette: Reds }
`;

  it('bakes computed classify breaks from a local url: file into the style', async () => {
    const dir = await mkdir();
    await writeFile(join(dir, 'grid.geojson'), JSON.stringify(CLASSIFY_DATA));
    const doc = join(dir, 'map.yaml');
    await writeFile(doc, classifyDoc('grid.geojson'));

    const { stdout } = await execAsync(`node "${CLI}" emit "${doc}" --strict`);
    const style = JSON.parse(stdout);
    const layer = style.layers.find((l: { id: string }) => l.id === 'grid');
    expect(layer.metadata['maplibre-yaml:classify']).toMatchObject({
      method: 'quantile',
      breaks: [12, 30],
      colors: ['#fee0d2', '#fc9272', '#de2d26'],
    });
    expect(JSON.stringify(layer.paint['circle-color'])).toContain('["step",["to-number",["var","value"]],"#fee0d2",12,"#fc9272",30,"#de2d26"]');
    expect(layer).not.toHaveProperty('classify');
  });

  it('resolves a root-relative url: under public/, as a static site serves it', async () => {
    const dir = await mkdir();
    const { mkdir: mkdirp } = await import('node:fs/promises');
    await mkdirp(join(dir, 'public', 'data'), { recursive: true });
    await mkdirp(join(dir, 'public', 'configs'), { recursive: true });
    await writeFile(join(dir, 'public', 'data', 'grid.geojson'), JSON.stringify(CLASSIFY_DATA));
    const doc = join(dir, 'public', 'configs', 'map.yaml');
    await writeFile(doc, classifyDoc('/data/grid.geojson'));

    const { stdout } = await execAsync(`node "${CLI}" emit "${doc}"`);
    const style = JSON.parse(stdout);
    expect(style.layers[0].metadata['maplibre-yaml:classify'].breaks).toEqual([12, 30]);
  });

  it('fails clearly when computed breaks need data it cannot load', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'map.yaml');
    await writeFile(doc, classifyDoc('missing/nowhere.geojson'));

    const failure = await execAsync(`node "${CLI}" emit "${doc}"`).catch((e) => e);
    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain('layers.grid.classify');
    expect(failure.stderr).toContain('missing/nowhere.geojson');
    expect(failure.stderr).toContain('breaks:');
  });

  // ml-aot.144: trust gates `!html` popups and `click.emit` host events, and
  // neither is part of a style.json, so --trust never changed the export. It
  // is deprecated: accepted, out of --help, and it says so on stderr.
  it('accepts --trust as a deprecated no-op: same style, a note on stderr, not in --help', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'map.yaml');
    await writeFile(
      doc,
      `type: map
id: gated
config:
  center: [-73.98, 40.75]
  zoom: 12
layers:
  - id: pts
    type: circle
    source:
      type: geojson
      data: { type: FeatureCollection, features: [] }
    paint: { circle-color: "#8899aa" }
    interactive:
      click:
        popup:
          - p: [{ str: !html "<b>hi</b>" }]
        emit: { event: select-feature }
`,
    );

    const plain = await execAsync(`node "${CLI}" emit "${doc}"`);
    expect(plain.stderr).not.toContain('--trust');
    for (const flag of ['--trust trusted', '--trust untrusted', '--trust=trusted']) {
      const run = await execAsync(`node "${CLI}" emit "${doc}" ${flag}`);
      expect(run.stdout).toBe(plain.stdout);
      expect(run.stderr).toContain('--trust is deprecated and has no effect');
    }

    // citty prints help through consola, which goes silent when it detects a
    // test runner: run the CLI as a user would (as preview-server.test.ts does).
    const env = { ...process.env };
    for (const key of ['VITEST', 'VITEST_POOL_ID', 'VITEST_WORKER_ID', 'TEST', 'NODE_ENV']) delete env[key];
    const help = await execAsync(`node "${CLI}" emit --help`, { env });
    expect(help.stdout).toContain('--target');
    expect(help.stdout).not.toContain('--trust');
  });

  // ml-aot.146: the refusal said "re-run with --with-fallbacks", which is
  // already the default and an error next to --strict.
  it('a --strict refusal for markers says to export without --strict', async () => {
    const dir = await mkdir();
    const doc = join(dir, 'map.yaml');
    await writeFile(
      doc,
      `type: map
id: pins
config:
  center: [0, 0]
  zoom: 2
markers:
  - at: [0, 0]
layers:
  - id: bg
    type: background
    paint: { background-color: "#eee" }
`,
    );

    const failure = await execAsync(`node "${CLI}" emit "${doc}" --strict`).catch((e) => e);
    expect(failure.code).toBe(1);
    expect(failure.stderr).toContain('markers');
    expect(failure.stderr).toContain('export without --strict');
    expect(failure.stderr).not.toContain('re-run with --with-fallbacks');
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
