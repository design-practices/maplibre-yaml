/**
 * @file The files the build-time loaders have read, for the dev-reload integration
 * @module @maplibre-yaml/astro/utils/dev-watch
 *
 * @description
 * `loadMapConfig`, `loadScrollytellingConfig`, `loadGlobalMapConfig` and
 * `feature_ref` read their files with `fs`, so Vite's module graph never
 * learns about them: `astro dev` neither reloads the page when one changes
 * nor re-runs a module that read one at its top level (a
 * `src/lib/map-config.ts` with `await loadGlobalMapConfig(...)` kept serving
 * the old file until a restart, ml-aot.24). Each loader records the absolute
 * path it read here; the integration (`@maplibre-yaml/astro/integration`)
 * watches those paths in dev.
 *
 * The registry lives on `globalThis` under a `Symbol.for` key: in dev the
 * loaders run inside Vite's SSR module runner, the integration in Astro's own
 * module scope -- separate module instances in the same process.
 *
 * @internal
 */

import { resolve } from "node:path";

const KEY = Symbol.for("@maplibre-yaml/astro:dev-watched-files");

/** The shared set of absolute paths the loaders have read in this process. */
export function watchedFiles(): Set<string> {
  const store = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  return (store[KEY] ??= new Set<string>());
}

/** Record a file a loader read (relative paths resolve against the cwd, as the loaders do). */
export function trackFile(path: string): void {
  watchedFiles().add(resolve(path));
}
