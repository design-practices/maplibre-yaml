import { describe, it, expect, afterAll } from 'vitest';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { parse as parseYAML } from 'yaml';
import { initArgsError, nextSteps } from '../../src/commands/init';
import { CORE_VERSION, minorPin } from '../../src/lib/package-versions';

const execAsync = promisify(exec);
/** The CDN pin the plain-HTML scaffolds load: core's own minor (ml-aot.92). */
const CORE_MINOR = minorPin(CORE_VERSION);
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
      expect(html).toContain(`src="https://unpkg.com/@maplibre-yaml/core@${CORE_MINOR}/register.js"`);
      // The import map must come before the module that needs it.
      expect(html.indexOf('type="importmap"')).toBeLessThan(html.indexOf('register.js'));
      expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
      expect(html).toMatch(/ml-map\s*\{[^}]*display:\s*block;[^}]*height:\s*100vh/);
      expect(html).toContain('<ml-map src="map.yaml"></ml-map>');
      // ml-3fd: how to publish under a subpath, as a comment the reader can act on.
      expect(html).toContain('base="/my-repo/"');
      expect(html).toContain('<title>my-map</title>');
    });

    it('writes a map.yaml that validates, with a keyless street basemap and quoted colours', async () => {
      const dir = await mkdir();
      await run('init my-map --template basic', dir);
      const yaml = await readFile(join(dir, 'my-map', 'map.yaml'), 'utf-8');
      expect(yaml).toContain('mapStyle: "https://tiles.openfreemap.org/styles/liberty"');
      expect(yaml).not.toMatch(/color:\s*#/);
      expect(yaml).toContain('id: my-map');
      // ml-3fd: bare relative paths work (#147); the "./" advice is gone.
      expect(yaml).not.toContain('start with ./');

      const validate = await run(`validate "${join(dir, 'my-map', 'map.yaml')}"`, dir);
      expect(validate.code).toBe(0);
      expect(validate.stdout).toContain('✓');
    });

    it('prints next steps that work for an npx user: serve the folder, npx for CLI commands', async () => {
      const dir = await mkdir();
      const { stdout } = await run('init my-map --template basic', dir);
      expect(stdout).toContain('cd my-map');
      expect(stdout).toContain('npx serve .');
      expect(stdout).toContain('npx maplibre-yaml@latest validate map.yaml');
      // Any other server must support range requests (cloud-native files): not "any static server".
      expect(stdout).not.toContain('Any static web server works');
      expect(stdout).toContain('range requests');
      expect(stdout).toContain('python -m http.server does not');
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
    it('scaffolds a story page that runs from the CDN: import map, core 0.8 (has <ml-scrollytelling>), viewport', async () => {
      const dir = await mkdir();
      const result = await run('init my-story --template story', dir);
      expect(result.code).toBe(0);
      const html = await readFile(join(dir, 'my-story', 'index.html'), 'utf-8');
      expect(html).toContain('"maplibre-gl": "https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.mjs"');
      expect(html).toContain('href="https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.css"');
      expect(html).toContain(`src="https://unpkg.com/@maplibre-yaml/core@${CORE_MINOR}/register.js"`);
      expect(html.indexOf('type="importmap"')).toBeLessThan(html.indexOf('register.js'));
      expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
      expect(html).toContain('<ml-scrollytelling src="story.yaml"></ml-scrollytelling>');
      expect(html).toContain('base="/my-repo/"');
      expect(html).not.toMatch(/0\.7/);
      // The "element is not in core 0.7 yet" note is gone; serve-and-open steps instead.
      expect(result.stdout).not.toMatch(/not part of|0\.7 yet/);
      expect(result.stdout).toContain('npx serve .');
      expect(result.stdout).toContain('npx maplibre-yaml@latest validate story.yaml');

      const validate = await run(`validate "${join(dir, 'my-story', 'story.yaml')}"`, dir);
      expect(validate.code).toBe(0);
    });

    it('puts theme at the top level, where the engine reads it, and no document keys under config (ml-aot.48)', async () => {
      const dir = await mkdir();
      expect((await run('init my-story --template story', dir)).code).toBe(0);
      const doc = parseYAML(await readFile(join(dir, 'my-story', 'story.yaml'), 'utf-8')) as Record<string, any>;
      expect(doc.theme).toBe('light');
      // Keys that belong next to config:, not inside it: the engine ignores them there.
      const documentKeys = [
        'theme', 'markers', 'legend', 'state', 'popups', 'layers', 'sources', 'controls',
        'images', 'parameters', 'chapters', 'showMarkers', 'markerColor', 'footer',
      ];
      expect(Object.keys(doc.config).filter((k) => documentKeys.includes(k))).toEqual([]);
    });
  });

  describe('astro template (ml-aot.32)', () => {
    /** Whether `version` satisfies a caret range like "^0.8.0" (no semver dep in the CLI). */
    const satisfiesCaret = (range: string, version: string): boolean => {
      const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range);
      if (!m) return false;
      const [rMaj, rMin, rPat] = m.slice(1).map(Number) as [number, number, number];
      const [vMaj, vMin, vPat] = version.split('-')[0]!.split('.').map(Number) as [number, number, number];
      if (vMaj !== rMaj) return false;
      if (rMaj === 0 && vMin !== rMin) return false; // ^0.x pins the minor
      if (vMin !== rMin) return vMin > rMin;
      return vPat >= rPat;
    };
    const workspaceVersion = async (pkg: string) =>
      JSON.parse(await readFile(join(process.cwd(), '..', pkg, 'package.json'), 'utf-8')).version as string;

    let dir: string;
    const file = (...p: string[]) => readFile(join(dir, 'my-site', ...p), 'utf-8');

    it('scaffolds with ranges that include the current core and astro packages', async () => {
      dir = await mkdir();
      const result = await run('init my-site --template astro', dir);
      expect(result.code).toBe(0);
      const pkg = JSON.parse(await file('package.json'));
      expect(pkg.name).toBe('my-site');
      // The ranges follow the workspace packages, so they cannot fall a minor behind again.
      const core = await workspaceVersion('core');
      const astroPkg = await workspaceVersion('astro');
      expect(satisfiesCaret(pkg.dependencies['@maplibre-yaml/core'], core)).toBe(true);
      expect(satisfiesCaret(pkg.dependencies['@maplibre-yaml/astro'], astroPkg)).toBe(true);
      expect(pkg.dependencies.astro).toMatch(/^\^7\./);
      expect(pkg.dependencies['maplibre-gl']).toMatch(/^\^6\./);
      expect(pkg.scripts.check).toBe('astro check');
      expect(pkg.devDependencies['@astrojs/check']).toBeDefined();
      expect(pkg.devDependencies.typescript).toBeDefined();
    });

    it('uses the @maplibre-yaml/astro components in a layout with the viewport meta', async () => {
      const page = await file('src', 'pages', 'index.astro');
      expect(page).toContain("import { Map } from '@maplibre-yaml/astro';");
      expect(page).toContain('<Map src="/configs/map.yaml"');
      // No hand-rolled element setup: the component does the worker and CSS.
      expect(page).not.toContain('setWorkerUrl');
      expect(page).not.toContain('<ml-map');
      const layout = await file('src', 'layouts', 'Layout.astro');
      expect(layout).toContain('<meta name="viewport" content="width=device-width, initial-scale=1" />');
      expect(layout).toMatch(/body\s*\{[^}]*margin:\s*0/);
    });

    it('wires the integration and explains site/base for GitHub Pages', async () => {
      const config = await file('astro.config.mjs');
      expect(config).toContain('import maplibreYaml from "@maplibre-yaml/astro/integration";');
      expect(config).toContain('integrations: [maplibreYaml()]');
      expect(config).toContain('// base: "/<your-repo>",');
      expect(config).toContain('// site: "https://<your-user>.github.io",');
    });

    it('ships a GitHub Pages workflow, a .gitignore and a tsconfig', async () => {
      const workflow = await file('.github', 'workflows', 'deploy.yml');
      expect(workflow).toContain('uses: withastro/action@');
      expect(workflow).toContain('uses: actions/deploy-pages@');
      // GitHub expression syntax survives the {{variable}} substitution.
      expect(workflow).toContain('${{ steps.deployment.outputs.page_url }}');
      const ignore = await file('.gitignore');
      expect(ignore).toContain('node_modules/');
      expect(ignore).toContain('dist/');
      expect(existsSync(join(dir, 'my-site', 'gitignore'))).toBe(false);
      expect(JSON.parse(await file('tsconfig.json')).extends).toBe('astro/tsconfigs/strict');
    });

    it('the map document validates', async () => {
      const validate = await run(`validate "${join(dir, 'my-site', 'public', 'configs', 'map.yaml')}"`, dir);
      expect(validate.code).toBe(0);
    });

    it('next steps mention npm run dev and base for GitHub Pages', () => {
      const text = nextSteps('astro', 'my-site').join('\n');
      expect(text).toContain('npm install');
      expect(text).toContain('npm run dev');
      expect(text).toContain('base');
      expect(text).toContain('astro.config.mjs');
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
