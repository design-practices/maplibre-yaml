/**
 * @file Preview server implementation
 */

import { createServer, type ViteDevServer } from 'vite';
import { watch } from 'chokidar';
import { resolve, dirname } from 'pathe';
import { readFile } from 'node:fs/promises';
import { YAMLParser, type ParseError } from '@maplibre-yaml/core';
import { logger } from '../lib/logger.js';
import { getDebugPanelHTML, getDebugPanelCSS, getDebugPanelJS } from './debug-panel.js';
import type { PreviewOptions } from '../types.js';

export interface PreviewServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  url: string;
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

  async function loadConfig(): Promise<{ valid: boolean; config?: any; error?: string }> {
    try {
      const content = await readFile(absoluteConfigPath, 'utf-8');
      const result = YAMLParser.safeParseMapBlock(content);

      if (result.success) {
        currentConfig = JSON.stringify(result.data);
        return { valid: true, config: result.data };
      } else {
        const errorMsg = result.errors.map((e: ParseError) => e.path ? e.path + ': ' + e.message : e.message).join('\n');
        return { valid: false, error: errorMsg };
      }
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error)
      };
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

    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>maplibre-yaml preview</title><link href="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css" rel="stylesheet" /><script src="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.js"></script><script type="importmap">{"imports":{"@maplibre-yaml/core/register":"https://esm.sh/@maplibre-yaml/core@0.1.2/dist/register.js"}}</script><style>* { margin: 0; padding: 0; box-sizing: border-box; }body { font-family: system-ui, -apple-system, sans-serif; }#map { width: 100vw; height: 100vh; }.error-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.8); display: flex; align-items: center; justify-content: center; z-index: 1000; }.error-box { background: #fef2f2; border: 2px solid #dc2626; border-radius: 8px; padding: 24px; max-width: 600px; max-height: 80vh; overflow: auto; }.error-title { color: #dc2626; font-weight: 600; font-size: 18px; margin-bottom: 12px; }.error-message { color: #991b1b; font-family: monospace; font-size: 14px; white-space: pre-wrap; }.status-bar { position: fixed; bottom: 0; left: 0; right: 0; background: #1f2937; color: white; padding: 8px 16px; font-size: 12px; display: flex; justify-content: space-between; z-index: 999; }.status-indicator { display: flex; align-items: center; gap: 8px; }.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; }.status-dot.error { background: #ef4444; }' + debugCSS + '</style></head><body><div id="map"></div>' + errorOverlay + debugPanel + '<div class="status-bar"><div class="status-indicator"><div class="status-dot ' + statusDotClass + '"></div><span>' + statusText + '</span></div><div><span>' + configPath + '</span></div></div><script type="module">import \'@maplibre-yaml/core/register\';const config = ' + configJson + ';if (config) {const mapEl = document.createElement(\'ml-map\');mapEl.style.cssText = \'width: 100%; height: 100%;\';mapEl.config = config;document.getElementById(\'map\').appendChild(mapEl);mapEl.addEventListener(\'ml-map:load\', () => console.log(\'[preview] Map loaded\'));mapEl.addEventListener(\'ml-map:error\', (e) => console.error(\'[preview] Map error:\', e.detail));}if (import.meta.hot) {import.meta.hot.on(\'yaml-update\', () => {console.log(\'[preview] Config updated, reloading...\');window.location.reload();});}</script><script>' + debugJS + '</script></body></html>';
  }

  const serverUrl = 'http://localhost:' + port;

  return {
    url: serverUrl,

    async start() {
      const initial = await loadConfig();

      viteServer = await createServer({
        root: configDir,
        server: { port, open: options.open ?? true },
        plugins: [{
          name: 'maplibre-yaml-preview',
          configureServer(server) {
            server.middlewares.use((req, res, next) => {
              if (req.url === '/' || req.url === '/index.html') {
                res.setHeader('Content-Type', 'text/html');
                res.end(createPreviewHTML(currentConfig, initial.valid ? null : initial.error!));
                return;
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
