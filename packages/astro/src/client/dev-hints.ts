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

if (import.meta.env.DEV && typeof document !== "undefined") {
  warnIfNoViewport();
}
