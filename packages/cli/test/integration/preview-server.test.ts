/**
 * `mlym preview` serves maplibre-gl 6 and core from the local install (ml-pru).
 *
 * @remarks
 * The preview page used to pin maplibre-gl@4 from the CDN (unpkg UMD + an
 * esm.sh import map), so a student's preview ran a different MapLibre than
 * the docs recommend, needed the network, and broke offline. These tests
 * start the real preview server and check the page it generates: the import
 * map points at locally served modules, those modules are the installed
 * files byte for byte, and maplibre-gl 6's worker (which it loads relative to
 * its own module URL) is served next to the module.
 *
 * Requires @maplibre-yaml/core to be built (like the other CLI integration
 * tests).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile, realpath } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'pathe';
import { createPreviewServer, resolveMaplibre, type PreviewServer } from '../../src/preview/server.js';

const MAP_DOC = `type: map
id: preview-test
config:
  center: [0, 0]
  zoom: 2
  mapStyle: "/style.json"
layers:
  - id: dots
    type: circle
    source:
      type: geojson
      data: { type: FeatureCollection, features: [] }
`;

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createNetServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolvePort(port));
    });
  });
}

/** The maplibre-gl the installed core resolves (its peer), as preview should. */
async function installedMaplibreDir(): Promise<string> {
  const coreDir = await realpath(join(process.cwd(), 'node_modules/@maplibre-yaml/core'));
  const req = createRequire(join(coreDir, 'package.json'));
  return dirname(req.resolve('maplibre-gl/package.json'));
}

function importMapOf(html: string): Record<string, string> {
  const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  expect(match, 'preview page has no import map').not.toBeNull();
  return JSON.parse(match![1]!).imports;
}

describe('preview server (integration)', () => {
  let dir: string;
  let server: PreviewServer;
  let base: string;
  let html: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mlym-preview-'));
    await writeFile(join(dir, 'map.yaml'), MAP_DOC);
    await writeFile(join(dir, 'style.json'), JSON.stringify({ version: 8, sources: {}, layers: [] }));
    const port = await freePort();
    server = await createPreviewServer(join(dir, 'map.yaml'), { port, open: false });
    await server.start();
    base = 'http://localhost:' + port;
    html = await (await fetch(base + '/')).text();
  }, 30_000);

  afterAll(async () => {
    await server?.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('loads no MapLibre from a CDN and no v4 UMD script', () => {
    expect(html).not.toMatch(/unpkg\.com|esm\.sh|jsdelivr/);
    expect(html).not.toContain('maplibre-gl@4');
    expect(html).not.toMatch(/<script[^>]+src="[^"]*maplibre-gl\.js"/);
  });

  it('maps maplibre-gl to the installed v6 ES module, byte for byte', async () => {
    const imports = importMapOf(html);
    const moduleUrl = imports['maplibre-gl'];
    expect(moduleUrl).toMatch(/^\/[^/]/); // served by the preview, not a CDN
    expect(moduleUrl).toMatch(/maplibre-gl\.mjs$/);

    const res = await fetch(base + moduleUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);

    const mlDir = await installedMaplibreDir();
    const pkg = JSON.parse(await readFile(join(mlDir, 'package.json'), 'utf-8'));
    expect(Number(pkg.version.split('.')[0])).toBeGreaterThanOrEqual(6);
    expect(await res.text()).toBe(await readFile(join(mlDir, 'dist/maplibre-gl.mjs'), 'utf-8'));
  });

  it("serves maplibre-gl 6's shared chunk and worker next to the module", async () => {
    const moduleUrl = importMapOf(html)['maplibre-gl']!;
    const dirUrl = moduleUrl.slice(0, moduleUrl.lastIndexOf('/') + 1);
    for (const file of ['maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs']) {
      const res = await fetch(base + dirUrl + file);
      expect(res.status, file).toBe(200);
      expect(res.headers.get('content-type'), file).toMatch(/javascript/);
    }
  });

  it('links the installed maplibre-gl CSS', async () => {
    const href = html.match(/<link href="([^"]+maplibre-gl\.css)"/)?.[1];
    expect(href).toBeDefined();
    expect(href).toMatch(/^\/[^/]/);
    const res = await fetch(base + href);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/css/);
  });

  it('maps @maplibre-yaml/core/register to the installed core browser bundle', async () => {
    const url = importMapOf(html)['@maplibre-yaml/core/register']!;
    expect(url).toMatch(/^\/[^/]/);
    const res = await fetch(base + url);
    expect(res.status).toBe(200);
    const coreDir = await realpath(join(process.cwd(), 'node_modules/@maplibre-yaml/core'));
    expect(await res.text()).toBe(await readFile(join(coreDir, 'dist/register.browser.js'), 'utf-8'));
  });

  it("serves the core bundle's on-demand chunks next to it (0.9: chunks/pmtiles.js, …)", async () => {
    const url = importMapOf(html)['@maplibre-yaml/core/register']!;
    const dirUrl = url.slice(0, url.lastIndexOf('/') + 1);
    const coreDir = await realpath(join(process.cwd(), 'node_modules/@maplibre-yaml/core'));
    for (const name of ['pmtiles', 'flatgeobuf']) {
      const res = await fetch(base + dirUrl + 'chunks/' + name + '.js');
      expect(res.status, name).toBe(200);
      expect(res.headers.get('content-type'), name).toMatch(/javascript/);
      expect(await res.text(), name).toBe(await readFile(join(coreDir, 'dist/chunks', name + '.js'), 'utf-8'));
    }
    for (const probe of ['chunks/..%2Fregister.browser.js', 'chunks/%2E%2E/index.js', 'chunks/nope.js']) {
      expect((await fetch(base + dirUrl + probe)).status, probe).not.toBe(200);
    }
  });

  it('does not serve files outside the maplibre-gl dist', async () => {
    const moduleUrl = importMapOf(html)['maplibre-gl']!;
    const dirUrl = moduleUrl.slice(0, moduleUrl.lastIndexOf('/') + 1);
    for (const probe of ['..%2Fpackage.json', '%2E%2E/package.json', 'nope.mjs']) {
      const res = await fetch(base + dirUrl + probe);
      const body = await res.text();
      expect(body, probe).not.toContain('"name": "maplibre-gl"');
      expect(res.status, probe).not.toBe(200);
    }
  });

  it('subscribes to live reload through the Vite client', async () => {
    expect(html).toContain('/@vite/client');
    expect(html).toContain('yaml-update');
    const res = await fetch(base + '/@vite/client');
    expect(res.status).toBe(200);
  });

  it('shows validation errors in the page', async () => {
    await writeFile(join(dir, 'map.yaml'), MAP_DOC.replace('type: circle', 'type: circel'));
    // The watcher reloads the config; poll until the page reflects it.
    let page = '';
    for (let i = 0; i < 50 && !page.includes('Configuration Error'); i++) {
      await new Promise((r) => setTimeout(r, 100));
      page = await (await fetch(base + '/')).text();
    }
    expect(page).toContain('Configuration Error');
    expect(page).toContain('circel');
    await writeFile(join(dir, 'map.yaml'), MAP_DOC);
  });
});

describe('resolveMaplibre', () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  async function fakeInstall(version: string, files: string[]): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'mlym-ml-'));
    dirs.push(root);
    const pkgDir = join(root, 'node_modules/maplibre-gl');
    await mkdir(join(pkgDir, 'dist'), { recursive: true });
    await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: 'maplibre-gl', version }));
    for (const f of files) await writeFile(join(pkgDir, 'dist', f), '');
    return root;
  }

  it('serves an installed maplibre-gl 6 from disk', async () => {
    const root = await fakeInstall('6.12.0', ['maplibre-gl.mjs', 'maplibre-gl.css']);
    const source = resolveMaplibre([join(root, 'some/project')]);
    expect(source.version).toBe('6.12.0');
    expect(source.distDir).toBe(join(await realpath(root), 'node_modules/maplibre-gl/dist'));
    expect(source.moduleUrl).toMatch(/^\/__maplibre-yaml\/.*maplibre-gl\.mjs$/);
  });

  it('falls back to the maplibre-gl 6 CDN build for a UMD-only (v5) install', async () => {
    const root = await fakeInstall('5.6.0', ['maplibre-gl.js', 'maplibre-gl.css']);
    const source = resolveMaplibre([root]);
    expect(source.distDir).toBeUndefined();
    expect(source.moduleUrl).toBe('https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.mjs');
    expect(source.cssUrl).toBe('https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.css');
  });

  it('takes the first usable install in search order', async () => {
    const v5 = await fakeInstall('5.6.0', ['maplibre-gl.js']);
    const v6 = await fakeInstall('6.4.1', ['maplibre-gl.mjs']);
    expect(resolveMaplibre([undefined, v5, v6]).version).toBe('6.4.1');
  });
});

describe('preview --help (ml-aot.54)', () => {
  it('describes --no-open as what it does: not opening the browser', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    // citty prints help through consola, which goes silent when it detects a
    // test runner (VITEST / TEST / NODE_ENV=test): run the CLI as a user would.
    const env = { ...process.env };
    for (const key of ['VITEST', 'VITEST_POOL_ID', 'VITEST_WORKER_ID', 'TEST', 'NODE_ENV']) delete env[key];
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [join(process.cwd(), 'dist/cli.js'), 'preview', '--help'],
      { env }
    );
    const line = stdout.split('\n').find((l) => l.includes('--no-open'));
    expect(line, stdout).toBeDefined();
    expect(line).toMatch(/Don't open|Do not open/);
    expect(line).not.toMatch(/\bOpen browser automatically\b/);
  });
});
