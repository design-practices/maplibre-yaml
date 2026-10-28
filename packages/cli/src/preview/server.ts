/**
 * @file Preview server implementation
 */

import { createServer, type ViteDevServer } from 'vite';
import { watch } from 'chokidar';
import { resolve, dirname, join, basename, extname, relative, isAbsolute } from 'pathe';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDocumentText, type ParseError } from '@maplibre-yaml/core';
import { logger } from '../lib/logger.js';
import { getDebugPanelHTML, getDebugPanelCSS, getDebugPanelJS } from './debug-panel.js';
import type { PreviewOptions } from '../types.js';

export interface PreviewServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  url: string;
}

/** Prefix of every route the preview serves itself (vs. files in the config dir) */
const ROUTE_PREFIX = '/__maplibre-yaml/';

/** Virtual route the import map points at when serving the locally installed core */
const LOCAL_REGISTER_ROUTE = ROUTE_PREFIX + 'register.js';

/** Virtual directory the locally installed maplibre-gl `dist/` is served from */
const LOCAL_MAPLIBRE_ROUTE = ROUTE_PREFIX + 'maplibre-gl/';

/**
 * CDN fallback when no usable maplibre-gl is installed. Major 6 is the line
 * the docs recommend (>= 6.4.1 carries the GHSA-jrc7-96c5-q579 fix); it is
 * ESM-only, and its worker is located relative to the module's own URL, so
 * the `dist/*.mjs` file is loaded directly -- esm.sh rewrites it and breaks
 * that lookup.
 */
const CDN_MAPLIBRE = {
  moduleUrl: 'https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.mjs',
  cssUrl: 'https://unpkg.com/maplibre-gl@6/dist/maplibre-gl.css',
};

interface CoreRegisterSource {
  /** Absolute path to the local register bundle (undefined -> CDN fallback) */
  localFile?: string;
  /** URL used in the import map for @maplibre-yaml/core/register */
  importUrl: string;
}

/** Where the preview page loads maplibre-gl from. */
export interface MaplibreSource {
  /** Absolute path to the installed `maplibre-gl/dist` (undefined -> CDN) */
  distDir?: string;
  /** Installed version, when served locally */
  version?: string;
  /** Import-map target for the bare `maplibre-gl` specifier */
  moduleUrl: string;
  /** Stylesheet URL */
  cssUrl: string;
}

/**
 * Find `<ancestor>/node_modules/<name>` walking up from `fromDir`, the way
 * Node resolves a bare specifier -- without going through the package's
 * `exports` (core exports only an `import` condition and no `package.json`,
 * so `require.resolve` cannot be used). Returns the real path, so a pnpm
 * symlink resolves to the store entry whose sibling `node_modules` holds the
 * package's own (peer) dependencies.
 */
function findPackageDir(name: string, fromDir: string): string | undefined {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Directory of this module (src/preview in tests, dist/ when bundled). */
function selfDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/** The installed @maplibre-yaml/core package directory, if any. */
function resolveCoreDir(): string | undefined {
  return findPackageDir('@maplibre-yaml/core', selfDir());
}

/**
 * Resolve the register bundle of the locally installed @maplibre-yaml/core,
 * so preview renders with the same core version that validated the config.
 *
 * Falls back to esm.sh pinned to the installed version if the browser bundle
 * is missing, and to unpinned esm.sh only if local resolution fails entirely.
 */
function resolveCoreRegister(coreDir: string | undefined): CoreRegisterSource {
  if (!coreDir) {
    // Local resolution failed entirely -- last resort, unpinned esm.sh
    return { importUrl: 'https://esm.sh/@maplibre-yaml/core/dist/register.js' };
  }

  // Prefer the browser bundle: yaml/zod are inlined, only maplibre-gl is
  // left as a bare specifier (mapped in the page's import map)
  const browserBundle = join(coreDir, 'dist', 'register.browser.js');
  if (existsSync(browserBundle)) {
    return { localFile: browserBundle, importUrl: LOCAL_REGISTER_ROUTE };
  }

  // No browser bundle in this install -- fall back to esm.sh pinned to the
  // INSTALLED version
  try {
    const pkg = JSON.parse(readFileSync(join(coreDir, 'package.json'), 'utf-8'));
    return { importUrl: 'https://esm.sh/@maplibre-yaml/core@' + pkg.version + '/dist/register.js' };
  } catch {
    return { importUrl: 'https://esm.sh/@maplibre-yaml/core/dist/register.js' };
  }
}

/**
 * Resolve the maplibre-gl the preview page should load.
 *
 * @remarks
 * Searched from the installed core first -- maplibre-gl is core's peer, so
 * that is the copy installed alongside it (npm and pnpm both place it where
 * core resolves it) -- then from each extra directory (the config's folder,
 * the working directory). The first maplibre-gl 6+ install with an ES module
 * build is served from disk: preview then works offline and matches the
 * installed version, and the worker (which v6 loads from next to its own
 * module URL) is served from the same directory.
 *
 * maplibre-gl 3-5 ship only a UMD bundle, which cannot satisfy the import
 * map's `maplibre-gl` ES module, so such an install falls back to the
 * maplibre-gl 6 CDN build, as does no install at all.
 */
export function resolveMaplibre(searchFrom: Array<string | undefined>): MaplibreSource {
  for (const from of searchFrom) {
    if (!from) continue;
    const dir = findPackageDir('maplibre-gl', from);
    if (!dir) continue;
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
      const major = Number(String(pkg.version).split('.')[0]);
      const distDir = join(dir, 'dist');
      if (major >= 6 && existsSync(join(distDir, 'maplibre-gl.mjs'))) {
        return {
          distDir,
          version: pkg.version,
          moduleUrl: LOCAL_MAPLIBRE_ROUTE + 'maplibre-gl.mjs',
          cssUrl: LOCAL_MAPLIBRE_ROUTE + 'maplibre-gl.css',
        };
      }
    } catch {
      // Unreadable package.json -- keep looking
    }
  }
  return { ...CDN_MAPLIBRE };
}

const CONTENT_TYPES: Record<string, string> = {
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Map a request under {@link LOCAL_MAPLIBRE_ROUTE} to a file in the installed
 * maplibre-gl `dist/`. Only plain file names with a served extension resolve
 * -- no separators, no dot segments -- so nothing outside `dist/` is reachable.
 */
function maplibreFile(distDir: string, requested: string): string | undefined {
  let name: string;
  try {
    name = decodeURIComponent(requested);
  } catch {
    return undefined;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes('..')) return undefined;
  if (!CONTENT_TYPES[extname(name)]) return undefined;
  const file = join(distDir, name);
  return existsSync(file) ? file : undefined;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** JSON safe to inline in a `<script>` (a string value cannot close the tag). */
function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * The file as the status bar shows it: relative to the folder the command
 * runs in when the file is inside it (`map.yaml`, `maps/city.yaml`), else
 * the full path. The bar truncates it with an ellipsis and keeps the full
 * path on hover (ml-aot.66: an absolute path wrapped into "Connected" on
 * phones).
 */
export function statusPath(absolute: string, cwd: string = process.cwd()): string {
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  };
  const rel = relative(real(cwd), real(absolute));
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : absolute;
}

/** The block types preview renders. */
export type PreviewKind = 'map' | 'scrollytelling';

export interface PreviewPageInput {
  /** Parsed config, or null when it failed to load/validate */
  config: unknown;
  /** What the config is: a map (`<ml-map>`) or a story (`<ml-scrollytelling>`). Default map. */
  kind?: PreviewKind;
  /** Error to overlay, or null */
  error: string | null;
  /** Path shown in the status bar */
  configPath: string;
  /** The file's full path, shown on hover (defaults to `configPath`) */
  configFullPath?: string;
  /** Import-map target for @maplibre-yaml/core/register */
  coreUrl: string;
  /** Where maplibre-gl comes from */
  maplibre: Pick<MaplibreSource, 'moduleUrl' | 'cssUrl'>;
  /** Show the debug panel */
  debug?: boolean;
}

/**
 * The preview page: maplibre-gl CSS, an import map for `maplibre-gl` and
 * the core register bundle, the `<ml-map>`, and a live-reload hook.
 *
 * @remarks
 * The page is served raw (not through Vite's HTML transform, which would try
 * to resolve the bare specifiers against the config folder), so
 * `import.meta.hot` does not exist in its inline script. Live reload
 * subscribes explicitly through the Vite client's `createHotContext`, in its
 * own module so a failure there cannot stop the map from rendering.
 */
export function createPreviewHTML(input: PreviewPageInput): string {
  const { config, error, configPath, coreUrl, maplibre, debug } = input;
  const fullPath = input.configFullPath ?? configPath;
  const story = input.kind === 'scrollytelling';
  const errorOverlay = error ? '<div class="error-overlay"><div class="error-box"><div class="error-title">Configuration Error</div><div class="error-message">' + escapeHtml(error) + '</div></div></div>' : '';
  const statusDotClass = error ? 'error' : '';
  const statusText = error ? 'Error in configuration' : 'Connected';

  // Debug panel (if enabled; it inspects a map's config, so maps only)
  const withDebug = debug && !story;
  const debugPanel = withDebug ? getDebugPanelHTML(config ?? null) : '';
  const debugCSS = withDebug ? getDebugPanelCSS() : '';
  const debugJS = withDebug ? getDebugPanelJS() : '';

  // A map fills #map; a story is a page that scrolls, so it goes in the body
  // flow (with room for the status bar) and #map is not used.
  const render = story
    ? 'const el = document.createElement(\'ml-scrollytelling\');el.config = config;document.getElementById(\'story\').appendChild(el);el.addEventListener(\'ml-scrollytelling:error\', (e) => console.error(\'[preview] Story error:\', e.detail));el.mapReady().then(() => console.log(\'[preview] Story loaded\'), () => {});'
    : 'const mapEl = document.createElement(\'ml-map\');mapEl.style.cssText = \'width: 100%; height: 100%;\';mapEl.config = config;document.getElementById(\'map\').appendChild(mapEl);mapEl.addEventListener(\'ml-map:load\', () => console.log(\'[preview] Map loaded\'));mapEl.addEventListener(\'ml-map:error\', (e) => console.error(\'[preview] Map error:\', e.detail));';
  const container = story ? '<div id="story"></div>' : '<div id="map"></div>';
  // The status bar (32px, fixed at the bottom) sits BELOW the map rather
  // than over it, so MapLibre's attribution and bottom controls stay visible
  // (ml-aot.54): #map is the viewport minus the bar, and so is a story's
  // sticky map.
  const storyCSS = story
    ? '#story { padding-bottom: 32px; }#story ml-scrollytelling { --ml-scrolly-map-height: calc(100vh - 32px); }'
    : '';

  const importMap = inlineJson({ imports: { '@maplibre-yaml/core/register': coreUrl, 'maplibre-gl': maplibre.moduleUrl } });

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>maplibre-yaml preview</title>'
    + '<link href="' + escapeHtml(maplibre.cssUrl) + '" rel="stylesheet" />'
    + '<script type="importmap">' + importMap + '</script>'
    + '<style>* { margin: 0; padding: 0; box-sizing: border-box; }body { font-family: system-ui, -apple-system, sans-serif; }#map { width: 100vw; height: calc(100vh - 32px); }.error-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.8); display: flex; align-items: center; justify-content: center; z-index: 1000; }.error-box { background: #fef2f2; border: 2px solid #dc2626; border-radius: 8px; padding: 24px; max-width: 600px; max-height: 80vh; overflow: auto; }.error-title { color: #dc2626; font-weight: 600; font-size: 18px; margin-bottom: 12px; }.error-message { color: #991b1b; font-family: monospace; font-size: 14px; white-space: pre-wrap; }.status-bar { position: fixed; bottom: 0; left: 0; right: 0; height: 32px; background: #1f2937; color: white; padding: 0 16px; font-size: 12px; display: flex; align-items: center; justify-content: space-between; z-index: 999; }.status-bar { gap: 12px; }.status-indicator { display: flex; align-items: center; gap: 8px; flex: none; white-space: nowrap; }.status-path { min-width: 0; overflow: hidden; text-align: right; }.status-path span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; }.status-dot.error { background: #ef4444; }' + storyCSS + debugCSS + '</style></head>'
    + '<body>' + container + errorOverlay + debugPanel
    + '<div class="status-bar"><div class="status-indicator"><div class="status-dot ' + statusDotClass + '"></div><span>' + statusText + '</span></div><div class="status-path"><span title="' + escapeHtml(fullPath) + '">' + escapeHtml(configPath) + '</span></div></div>'
    + '<script type="module">import \'@maplibre-yaml/core/register\';const config = ' + inlineJson(config ?? null) + ';if (config) {' + render + '}</script>'
    + '<script type="module">import { createHotContext } from \'/@vite/client\';const hot = createHotContext(\'/__maplibre-yaml/preview\');hot.on(\'yaml-update\', () => {console.log(\'[preview] Config updated, reloading...\');window.location.reload();});</script>'
    + '<script>' + debugJS + '</script></body></html>';
}

/**
 * One error for the error page: `path: message (line:column)`, the position
 * in the document's own format. A YAML or JSON syntax error already quotes it.
 */
function describeError(e: ParseError): string {
  const quoted = e.line !== undefined && e.message.includes('at line ' + e.line);
  const where = e.line !== undefined && !quoted ? ' (' + e.line + ':' + (e.column ?? 1) + ')' : '';
  return (e.path ? e.path + ': ' : '') + e.message + where;
}

/**
 * Create a preview server for a map or story document in YAML, JSON or TOML
 *
 * @remarks
 * The server parses the document (the file extension picks the format) and
 * inlines the validated value into the page, so the browser never needs the
 * TOML reader. The watcher follows the one file: an edit reloads the page,
 * a rename to another extension needs a restart.
 */
export async function createPreviewServer(
  configPath: string,
  options: PreviewOptions = {}
): Promise<PreviewServer> {
  const port = options.port ?? 3000;
  const absoluteConfigPath = resolve(configPath);
  const configDir = dirname(absoluteConfigPath);

  let viteServer: ViteDevServer | null = null;
  let watcher: ReturnType<typeof watch> | null = null;
  let currentConfig: unknown = null;
  let currentKind: PreviewKind = 'map';
  let currentError: string | null = null;

  const coreDir = resolveCoreDir();
  const coreRegister = resolveCoreRegister(coreDir);
  const maplibre = resolveMaplibre([coreDir, configDir, process.cwd()]);

  async function loadConfig(): Promise<{ valid: boolean; config?: any; error?: string }> {
    try {
      const content = await readFile(absoluteConfigPath, 'utf-8');
      const { blockType, result } = await parseDocumentText(content, {
        kind: 'any',
        signals: { fileName: absoluteConfigPath },
      });

      if (!result.success) {
        currentConfig = null;
        currentError = result.errors.map(describeError).join('\n');
        return { valid: false, error: currentError };
      }

      if (blockType === 'scrollytelling') {
        // core 0.8's <ml-scrollytelling> renders a story (ml-aot.41)
        currentConfig = result.data;
        currentKind = 'scrollytelling';
        currentError = null;
        return { valid: true, config: result.data };
      }

      if (blockType !== 'map') {
        // Valid document, but not something preview can render yet
        const kind = blockType === 'root' ? 'multi-page root document' : '"' + blockType + '" block';
        currentConfig = null;
        currentError = 'Visual preview currently supports only map and story documents (a type of map or scrollytelling).\n\n'
          + 'This file is a valid ' + kind + ' -- it passed validation, but preview cannot render it yet. '
          + 'Preview support for ' + (blockType === 'root' ? 'root documents' : blockType) + ' is planned for a future release.';
        return { valid: false, error: currentError };
      }

      currentConfig = result.data;
      currentKind = 'map';
      currentError = null;
      return { valid: true, config: result.data };
    } catch (error) {
      currentConfig = null;
      currentError = error instanceof Error ? error.message : String(error);
      return { valid: false, error: currentError };
    }
  }

  const serverUrl = 'http://localhost:' + port;

  return {
    url: serverUrl,

    async start() {
      await loadConfig();

      if (maplibre.distDir) {
        logger.info('Using maplibre-gl ' + maplibre.version + ' from ' + dirname(maplibre.distDir));
      } else {
        logger.warn('maplibre-gl 6 is not installed next to @maplibre-yaml/core; loading it from ' + maplibre.moduleUrl + ' (needs network)');
      }

      viteServer = await createServer({
        root: configDir,
        // The page is generated, not an index.html Vite could scan
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { port, open: options.open ?? true },
        plugins: [{
          name: 'maplibre-yaml-preview',
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              const url = (req.url ?? '').split('?')[0] ?? '';

              if (url === '/' || url === '/index.html') {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.end(createPreviewHTML({
                  config: currentConfig,
                  kind: currentKind,
                  error: currentError,
                  configPath: statusPath(absoluteConfigPath),
                  configFullPath: absoluteConfigPath,
                  coreUrl: coreRegister.importUrl,
                  maplibre,
                  debug: options.debug,
                }));
                return;
              }

              if (!url.startsWith(ROUTE_PREFIX)) {
                next();
                return;
              }

              // The installed maplibre-gl dist: module, shared chunk, worker,
              // CSS and their sourcemaps
              if (url.startsWith(LOCAL_MAPLIBRE_ROUTE)) {
                const file = maplibre.distDir
                  ? maplibreFile(maplibre.distDir, url.slice(LOCAL_MAPLIBRE_ROUTE.length))
                  : undefined;
                if (file) {
                  res.setHeader('Content-Type', CONTENT_TYPES[extname(file)]!);
                  res.end(readFileSync(file));
                  return;
                }
              } else if (coreRegister.localFile) {
                // The installed core register bundle (and its sourcemap,
                // requested relative to the bundle's real filename)
                const requested = url.slice(ROUTE_PREFIX.length);
                const files: Record<string, string> = {
                  'register.js': coreRegister.localFile,
                  [basename(coreRegister.localFile) + '.map']: coreRegister.localFile + '.map',
                };
                // The format readers the bundle loads on demand (0.9):
                // `./chunks/<name>.js`, relative to the bundle's URL.
                const chunk = /^chunks\/([A-Za-z0-9][A-Za-z0-9_-]*\.js(?:\.map)?)$/.exec(requested);
                if (chunk) files[requested] = join(dirname(coreRegister.localFile), 'chunks', chunk[1]!);
                const filePath = files[requested];
                if (filePath && existsSync(filePath)) {
                  res.setHeader('Content-Type', requested.endsWith('.map') ? 'application/json' : 'text/javascript');
                  res.end(readFileSync(filePath));
                  return;
                }
              }

              res.statusCode = 404;
              res.setHeader('Content-Type', 'text/plain; charset=utf-8');
              res.end('Not found');
            });
          },
        }],
      });

      await viteServer.listen();
      logger.success('Preview server running at ' + serverUrl);

      // Wait until a save has finished before reading: a save that truncates
      // first and writes after could otherwise be read half-way, showing a
      // spurious "Unable to determine document type" over the real error.
      watcher = watch(absoluteConfigPath, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 60, pollInterval: 20 },
      });
      watcher.on('change', async () => {
        logger.info('Configuration changed, reloading...');
        const result = await loadConfig();
        if (result.valid) {
          logger.success('Configuration valid');
        } else {
          logger.error('Configuration error: ' + result.error);
        }
        viteServer?.ws.send({
          type: 'custom',
          event: 'yaml-update',
          data: { valid: result.valid, error: result.error },
        });
      });
    },

    async stop() {
      await watcher?.close();
      await viteServer?.close();
    },
  };
}
