// @ts-check
/**
 * @file Astro integration: reload `astro dev` when a map file changes
 * @module @maplibre-yaml/astro/integration
 *
 * @description
 * Optional. Without it everything renders the same; it only fixes the
 * `astro dev` edit loop for files Vite does not track:
 *
 * - files read by `loadMapConfig`, `loadScrollytellingConfig`,
 *   `loadGlobalMapConfig`, `loadYAML` and `feature_ref` -- the dev server's
 *   cached modules are invalidated and the browser reloads, so even a
 *   module-level `await loadGlobalMapConfig(...)` (which otherwise kept the
 *   old file until a restart, ml-aot.24) picks up the edit;
 * - YAML / GeoJSON / JSON under `public/` (what `<Map src>` fetches) -- the
 *   browser reloads;
 * - maplibre-gl and `@maplibre-yaml/core/register` are pre-bundled when the
 *   dev server starts, so the first page with a map does not trigger a
 *   dependency re-optimization and a reload.
 *
 * Content-collection files need none of this; Astro reloads those itself.
 *
 * Plain JavaScript on purpose: `astro.config.mjs` imports it, and Astro first
 * loads the config with Node's own `import()`, which cannot load TypeScript
 * from `node_modules`. Types: ./integration.d.ts.
 *
 * @example
 * ```js
 * // astro.config.mjs
 * import { defineConfig } from "astro/config";
 * import maplibreYaml from "@maplibre-yaml/astro/integration";
 *
 * export default defineConfig({
 *   integrations: [maplibreYaml()],
 * });
 * ```
 */

import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The registry the loaders write to (src/utils/dev-watch.ts): absolute paths
 * of every file they read in this process. Shared through `globalThis`
 * because the loaders run inside Vite's SSR module runner and this file in
 * Astro's config scope -- separate module instances, one process.
 */
const WATCHED_KEY = Symbol.for("@maplibre-yaml/astro:dev-watched-files");

/** @returns {Set<string>} */
function watchedFiles() {
  const store = /** @type {Record<symbol, Set<string> | undefined>} */ (
    /** @type {unknown} */ (globalThis)
  );
  return (store[WATCHED_KEY] ??= new Set());
}

/**
 * What the components' client scripts import from node_modules: maplibre-gl
 * (the worker-URL setup) and core's element registration.
 */
export const CLIENT_DEPS = Object.freeze(["maplibre-gl", "@maplibre-yaml/core/register"]);

/** Extensions under `public/` whose edits reload the page. */
const PUBLIC_EXTENSIONS = new Set([".yaml", ".yml", ".geojson", ".json"]);

/**
 * The `@maplibre-yaml/astro` integration (dev-server reloads for map files).
 *
 * @param {Record<string, never>} [_options] Reserved; there are no options yet.
 */
export default function maplibreYaml(_options = {}) {
  return {
    name: "@maplibre-yaml/astro",
    hooks: {
      /**
       * @param {{
       *   command: string;
       *   config: { publicDir: URL | string };
       *   updateConfig: (config: Record<string, unknown>) => unknown;
       *   logger?: { info(message: string): void };
       * }} params
       */
      "astro:config:setup": ({ command, config, updateConfig, logger }) => {
        if (command !== "dev") return;
        const publicDir = resolve(
          typeof config.publicDir === "string"
            ? config.publicDir
            : fileURLToPath(config.publicDir)
        );
        updateConfig({
          vite: {
            // Pre-bundle the components' browser dependencies up front. They
            // are imported only from the components' <script>s, which Vite's
            // dependency scan does not see on Astro 4-6, so the first page
            // with a map discovered them late: Vite re-optimized, answered
            // already-requested modules with "504 (Outdated Optimize Dep)"
            // and reloaded the page mid-visit.
            optimizeDeps: { include: [...CLIENT_DEPS] },
            plugins: [devReloadPlugin(publicDir, (message) => logger?.info(message))],
          },
        });
      },
    },
  };
}

/**
 * The slice of Vite's dev server the plugin uses. Structural: `vite` is
 * Astro's dependency, not ours, and its API moved between the Vite majors
 * Astro 4-7 ship (6 added `environments`).
 *
 * @typedef {{ send(payload: { type: "full-reload"; path?: string }): void }} HotChannel
 * @typedef {{ invalidateAll(): void }} ModuleGraph
 * @typedef {{
 *   watcher: { on(event: string, cb: (file: string) => void): unknown };
 *   ws?: HotChannel;
 *   moduleGraph?: ModuleGraph;
 *   environments?: Record<string, { moduleGraph?: ModuleGraph; hot?: HotChannel } | undefined>;
 * }} DevServerLike
 */

/**
 * The Vite plugin behind the integration. Exported for tests.
 *
 * @param {string} publicDir Absolute path of the site's `public/` folder.
 * @param {(message: string) => void} [log]
 */
export function devReloadPlugin(publicDir, log = () => {}) {
  const publicPrefix = publicDir.endsWith(sep) ? publicDir : publicDir + sep;
  return {
    name: "maplibre-yaml:dev-reload",
    apply: /** @type {const} */ ("serve"),
    /** @param {DevServerLike} server */
    configureServer(server) {
      /** @param {string} file */
      const onFileEvent = (file) => {
        const path = resolve(file);
        if (watchedFiles().has(path)) {
          // Read with fs by a loader: no module knows it, so re-run them all.
          invalidateServerModules(server);
          log(`map file changed: ${path} — reloading`);
          fullReload(server);
        } else if (
          path.startsWith(publicPrefix) &&
          PUBLIC_EXTENSIONS.has(extname(path).toLowerCase())
        ) {
          log(`public map file changed: ${path} — reloading`);
          fullReload(server);
        }
      };
      server.watcher.on("change", onFileEvent);
      server.watcher.on("add", onFileEvent);
      server.watcher.on("unlink", onFileEvent);
    },
  };
}

/** @param {DevServerLike} server */
function invalidateServerModules(server) {
  const ssr = server.environments?.ssr;
  if (ssr) {
    // Vite 6+: drop the transform cache, and tell the SSR module runner
    // (Astro 6/7 render through it) to forget the modules it evaluated.
    ssr.moduleGraph?.invalidateAll();
    ssr.hot?.send({ type: "full-reload" });
  } else {
    // Vite 5 (Astro 4): ssrLoadModule re-evaluates invalidated modules.
    server.moduleGraph?.invalidateAll();
  }
}

/** @param {DevServerLike} server */
function fullReload(server) {
  const channel = server.environments?.client?.hot ?? server.ws;
  channel?.send({ type: "full-reload", path: "*" });
}
