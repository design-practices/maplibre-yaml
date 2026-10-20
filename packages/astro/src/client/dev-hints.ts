/**
 * @file Development-only hints for pages that use the components
 * @module @maplibre-yaml/astro/client/dev-hints
 *
 * @description
 * A page with no `<meta name="viewport">` is laid out ~980px wide on a phone
 * and shrunk to fit, so a `FullPageMap` or story map, its controls and its
 * chapter text come out tiny (ml-aot.33). Nothing errors, so the author has
 * no clue why. In `astro dev` the components say so once in the console.
 *
 * The check runs only when `import.meta.env.DEV` is true: Vite replaces it
 * with `false` in a production build and drops the code.
 *
 * It also tells core this is a development build, so the maps' author hints
 * (did-you-mean, misplaced keys, swapped coordinates) show on the page in
 * `astro dev` wherever it is served — a Codespaces or LAN address included —
 * and stay off the built site (ml-aot.57). Core reads the flag; it is not a
 * public switch (pages use the `debug` attribute / prop).
 */

/** The console message (exported for tests). */
export const MISSING_VIEWPORT_HINT =
  '[maplibre-yaml] This page has no <meta name="viewport">, so phones lay it out ' +
  "about 980px wide and shrink it: the map, its controls and any story text come " +
  'out tiny. Add <meta name="viewport" content="width=device-width, initial-scale=1"> ' +
  "to the page's <head> (or its layout). (This hint shows in astro dev only.)";

const WARNED = "__mlYamlViewportHinted";

/**
 * Warn once per page load when `doc` has no viewport meta.
 *
 * @returns Whether it warned.
 */
export function warnIfNoViewport(doc: Document = document): boolean {
  const win = doc.defaultView as (Window & { [WARNED]?: boolean }) | null;
  if (!win || win[WARNED]) return false;
  if (doc.querySelector('meta[name="viewport"]')) return false;
  win[WARNED] = true;
  console.warn(MISSING_VIEWPORT_HINT);
  return true;
}

/** Read by core's `showAuthorHints` (packages/core/src/components/author-hints.ts). */
const DEV_FLAG = "__MAPLIBRE_YAML_DEV__";

if (import.meta.env.DEV && typeof document !== "undefined") {
  (globalThis as Record<string, unknown>)[DEV_FLAG] = true;
  warnIfNoViewport();
}
