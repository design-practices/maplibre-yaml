import { describe, it, expect, afterAll } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { initArgsError, nextSteps } from '../../src/commands/init';

const execAsync = promisify(exec);
const CLI = join(process.cwd(), 'dist/cli.js');
// Plain output, so assertions do not depend on colour codes.
const ENV = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };

/** Run the built CLI in `cwd`; resolve with { code, stdout, stderr } instead of throwing. */
async function run(args: string, cwd: string) {
  try {
    const { stdout, stderr } = await execAsync(`node "${CLI}" ${args}`, { cwd, env: ENV });
    return { code: 0, stdout, stderr };
  } catch (error: any) {
    return { code: error.code as number, stdout: error.stdout as string, stderr: error.stderr as string };
  }
}

// Requires the CLI and @maplibre-yaml/core to be built.
describe('init command (integration)', () => {
  const tmpDirs: string[] = [];
  const mkdir = async () => {
    const d = await mkdtemp(join(tmpdir(), 'mlym-init-'));
    tmpDirs.push(d);
    return d;
  };
  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  describe('basic template', () => {
    it('scaffolds a page that runs from a static server with no build step', async () => {
      const dir = await mkdir();
      const result = await run('init my-map --template basic', dir);
      expect(result.code).toBe(0);

      const html = await readFile(join(dir, 'my-map', 'index.html'), 'utf-8');
      // The register bundle keeps maplibre-gl as a bare specifier: without an
      // import map the browser cannot resolve it and the page stays blank.
      expect(html).toContain('<script type="importmap">');
      expect(html).toContain('"maplibre-gl": "https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.mjs"');
      expect(html).toContain('href="https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.css"');
      expect(html).toContain('src="https://unpkg.com/@maplibre-yaml/core@0.7/register.js"');
      // The import map must come before the module that needs it.
      expect(html.indexOf('type="importmap"')).toBeLessThan(html.indexOf('register.js'));
      expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
      expect(html).toMatch(/ml-map\s*\{[^}]*display:\s*block;[^}]*height:\s*100vh/);
      expect(html).toContain('<ml-map src="./map.yaml"></ml-map>');
      expect(html).toContain('<title>my-map</title>');
    });

    it('writes a map.yaml that validates, with a keyless street basemap and quoted colours', async () => {
      const dir = await mkdir();
      await run('init my-map --template basic', dir);
      const yaml = await readFile(join(dir, 'my-map', 'map.yaml'), 'utf-8');
      expect(yaml).toContain('mapStyle: "https://tiles.openfreemap.org/styles/liberty"');
      expect(yaml).not.toMatch(/color:\s*#/);
      expect(yaml).toContain('id: my-map');

      const validate = await run(`validate "${join(dir, 'my-map', 'map.yaml')}"`, dir);
      expect(validate.code).toBe(0);
      expect(validate.stdout).toContain('✓');
    });

    it('prints next steps that work for an npx user: serve the folder, npx for CLI commands', async () => {
      const dir = await mkdir();
      const { stdout } = await run('init my-map --template basic', dir);
      expect(stdout).toContain('cd my-map');
      expect(stdout).toContain('npx serve .');
      expect(stdout).toContain('npx @maplibre-yaml/cli validate map.yaml');
      // A bare `maplibre-yaml …` command only exists after an install.
      expect(stdout).not.toMatch(/^\s*(maplibre-yaml|mlym) /m);
    });

    it('defaults to the basic template when --template is omitted', async () => {
      const dir = await mkdir();
      const result = await run('init my-map', dir);
      expect(result.code).toBe(0);
      expect(result.stdout + result.stderr).toMatch(/Using the basic template/);
      expect(existsSync(join(dir, 'my-map', 'index.html'))).toBe(true);
      expect(existsSync(join(dir, 'my-map', 'map.yaml'))).toBe(true);
    });

    it('names the project after the folder, not the path to it', async () => {
      const dir = await mkdir();
      await run('init maps/field-trip', dir);
      const yaml = await readFile(join(dir, 'maps', 'field-trip', 'map.yaml'), 'utf-8');
      expect(yaml).toContain('id: field-trip');
    });
  });

  describe('arguments init does not understand fail loudly, creating nothing', () => {
    it('an unknown template exits 1 and lists the real ones', async () => {
      const dir = await mkdir();
      const result = await run('init my-map --template advanced', dir);
      expect(result.code).toBe(1);
      expect(result.stdout + result.stderr).toContain('Unknown template "advanced"');
      expect(result.stdout + result.stderr).toMatch(/basic/);
      expect(await readdir(dir)).toEqual([]);
    });

    it('--dir (documented once, never implemented) exits 1 with the positional form', async () => {
      const dir = await mkdir();
      const result = await run('init --dir my-maps', dir);
      expect(result.code).toBe(1);
      expect(result.stdout + result.stderr).toContain('init has no --dir option');
      expect(result.stdout + result.stderr).toContain('init my-maps');
      expect(await readdir(dir)).toEqual([]);
    });

    it('an unknown flag exits 1', async () => {
      const dir = await mkdir();
      const result = await run('init my-map --tempalte story', dir);
      expect(result.code).toBe(1);
      expect(result.stdout + result.stderr).toContain('Unknown option for init: --tempalte');
      expect(await readdir(dir)).toEqual([]);
    });

    it('--list prints the templates, exits 0 and creates nothing', async () => {
      const dir = await mkdir();
      const result = await run('init --list', dir);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/basic/);
      expect(result.stdout).toMatch(/story/);
      expect(result.stdout).toMatch(/astro/);
      expect(await readdir(dir)).toEqual([]);
    });
  });

  describe('story template', () => {
    it('has the import map and pinned CDN head, and says the element is not in core 0.7 yet', async () => {
      const dir = await mkdir();
      const result = await run('init my-story --template story', dir);
      expect(result.code).toBe(0);
      const html = await readFile(join(dir, 'my-story', 'index.html'), 'utf-8');
      expect(html).toContain('"maplibre-gl": "https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.mjs"');
      expect(html).toContain('href="https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.css"');
      expect(html).toContain('<meta name="viewport"');
      expect(result.stdout).toMatch(/not part of\s+@maplibre-yaml\/core 0\.7 yet/);
      expect(result.stdout).toContain('npx @maplibre-yaml/cli validate story.yaml');
    });
  });

  describe('astro template', () => {
    it('pins current majors and sets up the maplibre-gl 6 worker in a bundled script', async () => {
      const dir = await mkdir();
      const result = await run('init my-site --template astro', dir);
      expect(result.code).toBe(0);
      const pkg = JSON.parse(await readFile(join(dir, 'my-site', 'package.json'), 'utf-8'));
      expect(pkg.name).toBe('my-site');
      expect(pkg.dependencies['@maplibre-yaml/core']).toBe('^0.7.0');
      expect(pkg.dependencies['maplibre-gl']).toBe('^6.4.1');

      const page = await readFile(join(dir, 'my-site', 'src', 'pages', 'index.astro'), 'utf-8');
      // A <script type="module"> is left unbundled by Astro, so a bare
      // '@maplibre-yaml/core/register' import in it never resolves.
      expect(page).not.toContain('<script type="module">');
      expect(page).toContain("import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';");
      expect(page).toContain('setWorkerUrl(workerUrl);');
      expect(page).toContain("import '@maplibre-yaml/core/register';");
    });
  });
});

describe('initArgsError', () => {
  it('accepts the documented forms', () => {
    expect(initArgsError([])).toBeNull();
    expect(initArgsError(['my-map'])).toBeNull();
    expect(initArgsError(['my-map', '--template', 'basic'])).toBeNull();
    expect(initArgsError(['my-map', '-t', 'story', '-n', 'Trip'])).toBeNull();
    expect(initArgsError(['--template=astro', 'site'])).toBeNull();
    expect(initArgsError(['--list'])).toBeNull();
  });

  it('rejects --dir, unknown flags and extra folders', () => {
    expect(initArgsError(['--dir', 'x'])).toMatch(/no --dir option/);
    expect(initArgsError(['--dir=x'])).toMatch(/no --dir option/);
    expect(initArgsError(['x', '--force'])).toMatch(/Unknown option for init: --force/);
    expect(initArgsError(['a', 'b'])).toMatch(/one folder name, got 2/);
  });
});

describe('nextSteps', () => {
  it('omits cd when scaffolding into the current folder', () => {
    expect(nextSteps('basic', null).join('\n')).not.toContain('cd ');
  });
});
