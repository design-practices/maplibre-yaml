/**
 * @file Same-origin tile templates, made absolute for MapLibre's worker
 * @module @maplibre-yaml/core/utils/tile-url
 *
 * @description
 * The source schema accepts same-origin tile paths (`/tiles/{z}/{x}/{y}.pbf`)
 * because serving tiles beside the page is ordinary. Raster tiles load on the
 * main thread, where a relative URL resolves against the page — but vector
 * tiles are fetched inside MapLibre's web worker, whose base URL is the
 * worker's blob, so a relative template silently loads nothing: the
 * document validates and the map renders empty. Resolving the template
 * against the page before it reaches MapLibre closes that gap.
 */

/** True when the string carries its own scheme (`https:`, `pmtiles:`, `data:` …). */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Resolve a tile URL template against a base URL, leaving `{z}`/`{x}`/`{y}`
 * (and any other `{token}`) intact. `new URL()` alone would percent-encode
 * the braces and break the template. Absolute and scheme-bearing templates
 * pass through untouched, as does everything when no base is available
 * (outside a browser).
 */
export function absolutizeTileTemplate(
  template: string,
  base: string | undefined = typeof document !== "undefined" ? document.baseURI : undefined
): string {
  if (!base || HAS_SCHEME.test(template)) return template;
  const tokens: string[] = [];
  const masked = template.replace(/\{[^}]*\}/g, (token) => `__mlym_t${tokens.push(token) - 1}__`);
  let resolved: string;
  try {
    resolved = new URL(masked, base).href;
  } catch {
    return template;
  }
  return resolved.replace(/__mlym_t(\d+)__/g, (_, i: string) => tokens[Number(i)]!);
}

/**
 * Absolutize a vector source's `tiles` list (the worker-fetched case);
 * every other source shape is returned unchanged.
 */
export function absolutizeVectorTiles<T extends Record<string, unknown>>(spec: T): T {
  if (spec["type"] !== "vector" || !Array.isArray(spec["tiles"])) return spec;
  return {
    ...spec,
    tiles: (spec["tiles"] as unknown[]).map((t) =>
      typeof t === "string" ? absolutizeTileTemplate(t) : t
    ),
  };
}

/**
 * A tile source's own URLs made absolute against the page: `tiles` (every
 * tile type) and a relative TileJSON `url`. MapLibre fetches some of these
 * in its worker (a relative URL then loads nothing), and a basemap style's
 * relative URLs are resolved against the style instead (renderer/
 * basemap-urls): a document source that is already absolute can never be
 * mistaken for one of those.
 */
export function absolutizeSourceUrls<T extends Record<string, unknown>>(spec: T): T {
  const type = spec["type"];
  if (type !== "vector" && type !== "raster" && type !== "raster-dem") return spec;
  let out: Record<string, unknown> = spec;
  const url = spec["url"];
  if (typeof url === "string" && url !== "" && !HAS_SCHEME.test(url)) {
    out = { ...out, url: absolutizeTileTemplate(url) };
  }
  if (Array.isArray(spec["tiles"])) {
    out = {
      ...out,
      tiles: (spec["tiles"] as unknown[]).map((t) => (typeof t === "string" ? absolutizeTileTemplate(t) : t)),
    };
  }
  return out as T;
}
