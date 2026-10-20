/**
 * @file Relative URLs inside a basemap style loaded from a URL (0.9)
 * @module @maplibre-yaml/core/renderer/basemap-urls
 *
 * @description
 * A self-hosted basemap — `public/basemap/style.json` beside a `.pmtiles`
 * extract, its sprite and its fonts — naturally names its files relative to
 * itself: `"url": "pmtiles://nyc.pmtiles"`, `"sprite": "sprites/light"`,
 * `"glyphs": "fonts/{fontstack}/{range}.pbf"`. MapLibre resolves none of
 * those against the style: main-thread requests resolve against the page,
 * worker requests against the worker's blob URL, and a `pmtiles://` URL with
 * a relative file inside reaches the protocol as-is. On a project site the
 * page is rarely in the style's folder, so the basemap loads nothing.
 *
 * **Rule: inside a style loaded from a URL, a relative URL is relative to the
 * style.json** — the way a stylesheet's `url()` is relative to the
 * stylesheet. That covers the source `url` (TileJSON or `pmtiles://<file>`),
 * `tiles`, `sprite` and `glyphs`. It is applied in MapLibre's
 * `transformRequest`, which sees every request for those resources before it
 * is made. The document's own sources never reach this with a relative URL:
 * the layer manager makes them absolute against the page first
 * (`absolutizeSourceUrls`), so the two rules cannot mix. `base` applies to
 * the style URL itself (as to every document URL), so a style under
 * `base="/my-repo/"` resolves its own files under `/my-repo/` too.
 */

import { absolutizeTileTemplate } from "../utils/tile-url";

/** MapLibre resource types whose URLs come from the style's own text. */
const STYLE_RESOURCES = new Set(["Source", "Tile", "Glyphs", "SpriteJSON", "SpriteImage"]);

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** What MapLibre's `transformRequest` returns (a subset). */
export interface TransformedRequest {
  url: string;
}

/** MapLibre's `transformRequest(url, resourceType)`. */
export type RequestTransformer = (url: string, resourceType?: string) => TransformedRequest | undefined;

/**
 * The style URL as the browser will request it, or `undefined` outside a
 * browser or for an unparsable URL.
 */
export function absoluteStyleUrl(styleUrl: string): string | undefined {
  try {
    const base = typeof document !== "undefined" ? document.baseURI : undefined;
    return new URL(styleUrl, base).href;
  } catch {
    return undefined;
  }
}

/**
 * `url` resolved against the style when it is relative (`pmtiles://` with a
 * relative file inside counts as relative); otherwise `undefined` (leave it).
 */
export function resolveAgainstStyle(url: string, styleUrl: string): string | undefined {
  const pm = /^pmtiles:\/\//i.exec(url);
  if (pm) {
    const inner = url.slice(pm[0].length);
    if (inner === "" || HAS_SCHEME.test(inner)) return undefined;
    const resolved = absolutizeTileTemplate(inner, styleUrl);
    return resolved === inner ? undefined : `pmtiles://${resolved}`;
  }
  if (HAS_SCHEME.test(url) || url.startsWith("//")) return undefined;
  const resolved = absolutizeTileTemplate(url, styleUrl);
  return resolved === url ? undefined : resolved;
}

/**
 * A `transformRequest` that resolves a URL-loaded basemap style's relative
 * URLs against the style, then hands the request to the host's own
 * `transformRequest`, if any.
 *
 * @param onPmtiles - Called with each `pmtiles://` source URL the style asks
 *   for (after resolution): the renderer checks the protocol is usable.
 */
export function basemapRequestTransformer(
  styleUrl: string,
  host?: RequestTransformer,
  onPmtiles?: (url: string) => void
): RequestTransformer {
  const style = absoluteStyleUrl(styleUrl);
  return (url, resourceType) => {
    let next = url;
    if (style && resourceType && STYLE_RESOURCES.has(resourceType)) {
      next = resolveAgainstStyle(url, style) ?? url;
    }
    if (resourceType === "Source" && /^pmtiles:\/\//i.test(next)) onPmtiles?.(next);
    const fromHost = host?.(next, resourceType);
    return fromHost ?? (next !== url ? { url: next } : undefined);
  };
}
