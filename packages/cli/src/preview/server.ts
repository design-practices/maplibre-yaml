/**
 * @file Preview server implementation
 */

import { createServer, type ViteDevServer } from 'vite';
import { watch } from 'chokidar';
import { resolve, dirname, join, basename } from 'pathe';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { YAMLParser, type ParseError } from '@maplibre-yaml/core';
import { logger } from '../lib/logger.js';
import { getDebugPanelHTML, getDebugPanelCSS, getDebugPanelJS } from './debug-panel.js';
import type { PreviewOptions } from '../types.js';

export interface PreviewServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  url: string;
}

/** Virtual route the import map points at when serving the locally installed core */
const LOCAL_REGISTER_ROUTE = '/__maplibre-yaml/register.js';

interface CoreRegisterSource {
  /** Absolute path to the local register bundle (undefined -> CDN fallback) */
  localFile?: string;
  /** URL used in the import map for @maplibre-yaml/core/register */
  importUrl: string;
}

/**
 * Resolve the register bundle of the locally installed @maplibre-yaml/core,
 * so preview renders with the same core version that validated the config.
 *
 * Uses import.meta.resolve because the package's "./register" export only
 * declares an "import" condition (createRequire().resolve would fail with
 * ERR_PACKAGE_PATH_NOT_EXPORTED). Falls back to esm.sh pinned to the
 * installed version if the browser bundle is missing, and to unpinned
 * esm.sh only if local resolution fails entirely.
 */
function resolveCoreRegister(): CoreRegisterSource {
  try {
    const registerPath = fileURLToPath(import.meta.resolve('@maplibre-yaml/core/register'));
    const distDir = dirname(registerPath);

    // Prefer the browser bundle: yaml/zod are inlined, only maplibre-gl is
    // left as a bare specifier (mapped in the page's import map)
    const browserBundle = join(distDir, 'register.browser.js');
    if (existsSync(browserBundle)) {
      return { localFile: browserBundle, importUrl: LOCAL_REGISTER_ROUTE };
    }

    // No browser bundle in this install -- fall back to esm.sh pinned to the
    // INSTALLED version, read from the resolved package's package.json
    const pkg = JSON.parse(readFileSync(join(dirname(distDir), 'package.json'), 'utf-8'));
    return { importUrl: 'https://esm.sh/@maplibre-yaml/core@' + pkg.version + '/dist/register.js' };
  } catch {
    // Local resolution failed entirely -- last resort, unpinned esm.sh
    return { importUrl: 'https://esm.sh/@maplibre-yaml/core/dist/register.js' };
  }
}

/**
 * Create a preview server for a YAML configuration
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
  let currentConfig: string | null = null;
  let currentError: string | null = null;

  const coreRegister = resolveCoreRegister();

  async function loadConfig(): Promise<{ valid: boolean; config?: any; error?: string }> {
    try {
      const content = await readFile(absoluteConfigPath, 'utf-8');
      const { blockType, result } = YAMLParser.safeParseAny(content);

      if (!result.success) {
        currentConfig = null;
        currentError = result.errors.map((e: ParseError) => e.path ? e.path + ': ' + e.message : e.message).join('\n');
        return { valid: false, error: currentError };
      }

      if (blockType !== 'map') {
        // Valid document, but not something preview can render yet
        const kind = blockType === 'root' ? 'multi-page root document' : '"' + blockType + '" block';
        currentConfig = null;
        currentError = 'Visual preview currently supports only "type: map" blocks.\n\n'
          + 'This file is a valid ' + kind + ' -- it passed validation, but preview cannot render it yet. '
          + 'Preview support for ' + (blockType === 'root' ? 'root documents' : blockType) + ' is planned for a future release.';
        return { valid: false, error: currentError };
      }

      currentConfig = JSON.stringify(result.data);
      currentError = null;
      return { valid: true, config: result.data };
    } catch (error) {
      currentConfig = null;
      currentError = error instanceof Error ? error.message : String(error);
      return { valid: false, error: currentError };
    }
  }

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function createPreviewHTML(config: string | null, error: string | null): string {
    const errorOverlay = error ? '<div class="error-overlay"><div class="error-box"><div class="error-title">Configuration Error</div><div class="error-message">' + escapeHtml(error) + '</div></div></div>' : '';
    const statusDotClass = error ? 'error' : '';
    const statusText = error ? 'Error in configuration' : 'Connected';
    const configJson = config ?? 'null';
    const configObj = config ? JSON.parse(config) : null;

    // Debug panel (if enabled)
    const debugPanel = options.debug ? getDebugPanelHTML(configObj) : '';
    const debugCSS = options.debug ? getDebugPanelCSS() : '';
    const debugJS = options.debug ? getDebugPanelJS() : '';

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>maplibre-yaml preview</title><link href="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css" rel="stylesheet" /><script src="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.js"></script><script type="importmap">' + JSON.stringify({ imports: { '@maplibre-yaml/core/register': coreRegister.importUrl, 'maplibre-gl': 'https://esm.sh/maplibre-gl@4' } }) + '</script><style>* { margin: 0; padding: 0; box-sizing: border-box; }body { font-family: system-ui, -apple-system, sans-serif; }#map { width: 100vw; height: 100vh; }.error-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.8); display: flex; align-items: center; justify-content: center; z-index: 1000; }.error-box { background: #fef2f2; border: 2px solid #dc2626; border-radius: 8px; padding: 24px; max-width: 600px; max-height: 80vh; overflow: auto; }.error-title { color: #dc2626; font-weight: 600; font-size: 18px; margin-bottom: 12px; }.error-message { color: #991b1b; font-family: monospace; font-size: 14px; white-space: pre-wrap; }.status-bar { position: fixed; bottom: 0; left: 0; right: 0; background: #1f2937; color: white; padding: 8px 16px; font-size: 12px; display: flex; justify-content: space-between; z-index: 999; }.status-indicator { display: flex; align-items: center; gap: 8px; }.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; }.status-dot.error { background: #ef4444; }' + debugCSS + '</style></head><body><div id="map"></div>' + errorOverlay + debugPanel + '<div class="status-bar"><div class="status-indicator"><div class="status-dot ' + statusDotClass + '"></div><span>' + statusText + '</span></div><div><span>' + configPath + '</span></div></div><script type="module">import \'@maplibre-yaml/core/register\';const config = ' + configJson + ';if (config) {const mapEl = document.createElement(\'ml-map\');mapEl.style.cssText = \'width: 100%; height: 100%;\';mapEl.config = config;document.getElementById(\'map\').appendChild(mapEl);mapEl.addEventListener(\'ml-map:load\', () => console.log(\'[preview] Map loaded\'));mapEl.addEventListener(\'ml-map:error\', (e) => console.error(\'[preview] Map error:\', e.detail));}if (import.meta.hot) {import.meta.hot.on(\'yaml-update\', () => {console.log(\'[preview] Config updated, reloading...\');window.location.reload();});}</script><script>' + debugJS + '</script></body></html>';
  }

  const serverUrl = 'http://localhost:' + port;

  return {
    url: serverUrl,

    async start() {
      await loadConfig();

      viteServer = await createServer({
        root: configDir,
        server: { port, open: options.open ?? true },
        plugins: [{
          name: 'maplibre-yaml-preview',
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              const url = (req.url ?? '').split('?')[0];

              if (url === '/' || url === '/index.html') {
                res.setHeader('Content-Type', 'text/html');
                res.end(createPreviewHTML(currentConfig, currentError));
                return;
              }

              // Serve the locally installed core register bundle (and its
              // sourcemap, requested relative to the bundle's real filename)
              if (coreRegister.localFile && url.startsWith('/__maplibre-yaml/')) {
                const requested = url.slice('/__maplibre-yaml/'.length);
                const files: Record<string, string> = {
                  'register.js': coreRegister.localFile,
                  [basename(coreRegister.localFile) + '.map']: coreRegister.localFile + '.map',
                };
                const filePath = files[requested];
                if (filePath && existsSync(filePath)) {
                  res.setHeader('Content-Type', requested.endsWith('.map') ? 'application/json' : 'text/javascript');
                  res.end(readFileSync(filePath));
                  return;
                }
              }

              next();
            });
          },
        }],
      });

      await viteServer.listen();
      logger.success('Preview server running at ' + serverUrl);

      watcher = watch(absoluteConfigPath, { ignoreInitial: true });
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
