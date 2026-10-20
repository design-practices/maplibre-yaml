/**
 * @file The one table of user-facing strings maplibre-yaml renders
 * @module @maplibre-yaml/core/i18n
 *
 * @description
 * Every word the library itself puts on a page — the legend's toggle, the
 * "part of this map couldn't load" notice, the story's chapter rail, the
 * params panel's notice — comes from {@link DEFAULT_STRINGS}, and a document
 * overrides any of them in the same `locale:` map MapLibre reads for its own
 * controls (`config.locale` in v1, `runtime.map.locale` in v2):
 *
 * ```yaml
 * config:
 *   locale:
 *     NavigationControl.ZoomIn: Acercar          # MapLibre's own key
 *     maplibre-yaml.Legend.Title: Leyenda         # ours, same table
 * ```
 *
 * Our keys all start with `maplibre-yaml.`, so they can never collide with
 * MapLibre's (`NavigationControl.ZoomIn`, `Map.Title`, ...), and MapLibre
 * ignores them. English is the only bundled language: a translation is a
 * `locale:` table the author writes (the docs list every key).
 *
 * Diagnostics written for the map's author — the reason a layer didn't draw,
 * the did-you-mean hints — stay in English; so does anything shown before a
 * document has been read (a `src` that didn't load, YAML that didn't parse),
 * since there is no `locale:` yet to read.
 *
 * Pure: no DOM, safe to import on a server (Astro frontmatter).
 */

/** The prefix every maplibre-yaml key carries in a `locale:` table. */
export const STRINGS_PREFIX = "maplibre-yaml.";

/**
 * maplibre-yaml's user-facing strings, in English. Keys are the names an
 * author writes in `locale:`; `{name}` marks a value filled in at runtime
 * (keep it in a translation). In messages, `` `backticks` `` mark code.
 */
export const DEFAULT_STRINGS = {
  // The legend's toggle (plain maps: the collapsible header; stories: the
  // button). A custom `legend.title` is a heading inside the panel instead.
  "maplibre-yaml.Legend.Title": "Legend",

  // The on-map notice when part of a document didn't load.
  "maplibre-yaml.Notice.Title": "Part of this map couldn't load",
  "maplibre-yaml.Notice.AuthorDetails": "Details for the site's author",
  "maplibre-yaml.Notice.Dismiss": "Dismiss this notice",
  "maplibre-yaml.Notice.More": "…and {count} more (see the browser console).",

  // Error cards that replace a document that was read but can't render.
  "maplibre-yaml.ErrorCard.HowToFix": "How to fix it:",
  "maplibre-yaml.ErrorCard.ConfigurationError": "Configuration Error",
  "maplibre-yaml.ErrorCard.MapError": "Map Error",
  "maplibre-yaml.ErrorCard.StyleNotLoaded": "The basemap style didn't load",
  "maplibre-yaml.ErrorCard.StyleHint":
    "Check {key}: open the URL in a new browser tab to see what it returns. A " +
    'MapLibre style is a JSON file with "version": 8, "sources" and "layers" — a ' +
    "tile URL, a GeoJSON file or a web page won't work. To test quickly, use " +
    '"https://demotiles.maplibre.org/style.json".',
  "maplibre-yaml.ErrorCard.LocalServer": "Open this page through a local web server",
  "maplibre-yaml.ErrorCard.LocalServerHint":
    "Start a local web server in this page's folder — for example, run " +
    '"npx serve ." in a terminal there, or use VS Code\'s "Live Server" ' +
    "extension — then open the http://localhost address it prints.",

  // Shown on the page when `<ml-map>` has no height.
  "maplibre-yaml.HeightHint":
    "This map is invisible because the `<ml-map>` element has no height. Give it one, " +
    'for example `<ml-map style="display:block; height:400px">` — or in your CSS: ' +
    "`ml-map { display: block; height: 400px; }`",

  // The params panel (`state:` + `parameters:`) below maplibre-gl 5.6.
  "maplibre-yaml.Params.StateUnsupported":
    "Parameter controls need maplibre-gl ≥ 5.6 (global state); this map renders " +
    "with the document's defaults.",

  // Stories.
  "maplibre-yaml.Story.Chapters": "Story chapters",
  "maplibre-yaml.Story.GoToChapter": "Go to chapter {number}: {title}",
  "maplibre-yaml.Story.ImageMissing": "This chapter's image couldn't load.",
  "maplibre-yaml.Story.VideoMissing": "This chapter's video couldn't load.",
  "maplibre-yaml.Story.MediaMissingHint":
    '"{src}" didn\'t load. Check the file name and folder — capital letters count ' +
    "(Photo.JPG and photo.jpg are different files on most web servers).",
  "maplibre-yaml.Story.VideoUnsupported": "Your browser does not support the video element.",

  // Astro's <FullPageMap> chrome (its zoom buttons use MapLibre's
  // NavigationControl.ZoomIn / NavigationControl.ZoomOut).
  "maplibre-yaml.FullPageMap.ResetView": "Reset view",
} as const;

/** A maplibre-yaml string key. */
export type StringKey = keyof typeof DEFAULT_STRINGS;

/**
 * MapLibre's English defaults for the few of ITS keys the library reads too
 * (the map's accessible name, the zoom buttons Astro's `<FullPageMap>` draws
 * itself), so a `locale:` that translates MapLibre's controls translates
 * these with them.
 */
export const MAPLIBRE_STRINGS = {
  "Map.Title": "Map",
  "NavigationControl.ZoomIn": "Zoom in",
  "NavigationControl.ZoomOut": "Zoom out",
} as const;

/** A MapLibre key the library reads. */
export type MapLibreStringKey = keyof typeof MAPLIBRE_STRINGS;

/** Values a string's `{placeholders}` are filled from. */
export type StringParams = Record<string, string | number>;

/** Looks a string up: the document's `locale:` first, then the English default. */
export type Strings = (key: StringKey | MapLibreStringKey, params?: StringParams) => string;

/** A document's `locale:` table, whatever was passed. */
function asTable(locale: unknown): Record<string, unknown> {
  return locale && typeof locale === "object" && !Array.isArray(locale)
    ? (locale as Record<string, unknown>)
    : {};
}

/** `{name}` → `params.name`; an unknown placeholder stays as written. */
export function fillPlaceholders(template: string, params?: StringParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

/**
 * The lookup for one document's `locale:` table.
 *
 * @param locale - the document's `locale:` (v1 `config.locale`, v2
 *   `runtime.map.locale`); anything that isn't an object means "no overrides".
 * @returns a function from key (and placeholder values) to text. A key the
 *   table doesn't set, or sets to something other than a non-empty string,
 *   falls back to English.
 *
 * @example
 * ```ts
 * const t = createStrings({ "maplibre-yaml.Legend.Title": "Leyenda" });
 * t("maplibre-yaml.Legend.Title"); // "Leyenda"
 * t("maplibre-yaml.Notice.More", { count: 3 }); // "…and 3 more (see the browser console)."
 * ```
 */
export function createStrings(locale?: unknown): Strings {
  const table = asTable(locale);
  return (key, params) => {
    const own = table[key];
    const template =
      typeof own === "string" && own.trim() !== ""
        ? own
        : ((DEFAULT_STRINGS as Record<string, string>)[key] ??
          (MAPLIBRE_STRINGS as Record<string, string>)[key] ??
          key);
    return fillPlaceholders(template, params);
  };
}

/** The English strings (no overrides). */
export const defaultStrings: Strings = createStrings();

/**
 * A map or story document's `locale:` table: `config.locale` (v1 and
 * stories) or `runtime.map.locale` (v2). `undefined` when it has none.
 */
export function documentLocale(doc: unknown): Record<string, unknown> | undefined {
  if (!doc || typeof doc !== "object") return undefined;
  const d = doc as {
    version?: unknown;
    config?: { locale?: unknown };
    runtime?: { map?: { locale?: unknown } };
  };
  const locale = d.version === 2 ? d.runtime?.map?.locale : d.config?.locale;
  return locale && typeof locale === "object" && !Array.isArray(locale)
    ? (locale as Record<string, unknown>)
    : undefined;
}

/**
 * The language an element is in: its nearest `lang` attribute (on the
 * element, an ancestor such as `<ml-map lang>`, or `<html lang>`), or
 * `undefined` when none is set — the browser's own language then applies.
 * Numbers are formatted for it unless a format names its own `locale`.
 */
export function elementLanguage(element: Element | null | undefined): string | undefined {
  try {
    const lang = element?.closest?.("[lang]")?.getAttribute("lang")?.trim();
    return lang ? lang : undefined;
  } catch {
    return undefined;
  }
}
