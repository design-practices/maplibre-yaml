/**
 * @file A full MapLibre style from the Protomaps basemap shorthand (0.9, ml-cnv.7)
 * @module @maplibre-yaml/core/formats/protomaps-style
 *
 * @description
 * `mapStyle: { pmtiles: data/nyc.pmtiles, flavor: dark, lang: es }` becomes
 * the style the Protomaps documentation builds by hand:
 *
 * - one vector source, `protomaps`, reading the file through `pmtiles://`
 *   (registered by core for every map), with the OpenStreetMap and Protomaps
 *   attribution;
 * - the flavor's layers, from `@protomaps/basemaps` (an on-demand chunk,
 *   reached only through `getDecoder("protomaps-basemap")`);
 * - glyphs and sprite from Protomaps' hosted assets, unless `glyphs:` /
 *   `sprite:` point elsewhere (full self-hosting). Labels need the glyph
 *   host reachable.
 *
 * Shared by the renderer (in the page, URLs made absolute against it) and
 * by `mlym emit` (in Node, URLs written as given).
 */

import type { ProtomapsBasemap } from "../schemas/basemap.schema";
import { protomapsBasemapOf, PROTOMAPS_FLAVORS, PROTOMAPS_LANGUAGES } from "../schemas/basemap.schema";
import { absolutizeTileTemplate } from "../utils/tile-url";
import { getDecoder, prefetchDecoder } from "./decoders";

/** The id of the generated style's one source (the name Protomaps' own examples use). */
export const PROTOMAPS_SOURCE_ID = "protomaps";

/** Protomaps' hosted fonts and sprites (github.com/protomaps/basemaps-assets). */
export const PROTOMAPS_ASSETS = "https://protomaps.github.io/basemaps-assets";

/** Default glyph template. */
export const PROTOMAPS_GLYPHS = `${PROTOMAPS_ASSETS}/fonts/{fontstack}/{range}.pbf`;

/** Default sprite for a flavor. */
export function protomapsSprite(flavor: string): string {
  return `${PROTOMAPS_ASSETS}/sprites/v4/${flavor}`;
}

/** Attribution every Protomaps basemap carries: the data is OpenStreetMap's. */
export const PROTOMAPS_ATTRIBUTION =
  '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © ' +
  '<a href="https://openstreetmap.org/copyright">OpenStreetMap</a>';

/** Tile layers every Protomaps basemap file has; their absence means another kind of file. */
const BASEMAP_TILE_LAYERS = ["earth", "water", "roads", "places"];

/** How the URLs in the shorthand are written into the style. */
export interface ProtomapsStyleOptions {
  /**
   * The page URL relative paths resolve against (`document.baseURI`, after
   * `base` has been applied to the document). Omitted (emit), every URL is
   * written as given.
   */
  pageUrl?: string;
  /** The page's language at the map (`lang`), the label default when the basemap has it. */
  pageLanguage?: string;
}

/**
 * The label language: `lang:` when given; otherwise the page's, when the
 * basemap has labels in it (`es-MX` → `es`, `zh-TW` → `zh-Hant`); else `en`.
 */
export function basemapLanguage(spec: Pick<ProtomapsBasemap, "lang">, pageLanguage?: string): string {
  if (typeof spec.lang === "string" && spec.lang !== "") return spec.lang;
  const known: readonly string[] = PROTOMAPS_LANGUAGES;
  if (pageLanguage) {
    const tag = pageLanguage.toLowerCase();
    if (tag.startsWith("zh")) {
      return /^zh-(hant|tw|hk|mo)\b/.test(tag) ? "zh-Hant" : "zh-Hans";
    }
    const primary = tag.split("-")[0]!;
    const mapped = primary === "nb" || primary === "nn" ? "no" : primary;
    if (known.includes(mapped)) return mapped;
  }
  return "en";
}

/** The shorthand's `pmtiles:` as a `pmtiles://` URL, its file resolved against `pageUrl` when given. */
export function protomapsTilesUrl(pmtiles: string, pageUrl?: string): string {
  const inner = pmtiles.replace(/^pmtiles:\/\//i, "");
  return `pmtiles://${pageUrl ? absolutizeTileTemplate(inner, pageUrl) : inner}`;
}

/** The file a `pmtiles://` URL reads, for messages: a same-origin path, else the full URL. */
function fileOf(url: string): string {
  const file = url.replace(/^pmtiles:\/\//i, "");
  try {
    const here = typeof location !== "undefined" ? location : undefined;
    const target = new URL(file, here?.href);
    return here && target.origin === here.origin ? target.pathname + target.search : file;
  } catch {
    return file;
  }
}

/**
 * Build the full style for a Protomaps basemap shorthand.
 *
 * @throws Error for a flavor this version doesn't have (validation refuses
 *   it first; this guards a programmatic config), or when the generator
 *   module fails to load.
 */
export async function protomapsStyle(
  spec: ProtomapsBasemap,
  options: ProtomapsStyleOptions = {}
): Promise<Record<string, unknown>> {
  // Any case (`flavor: Dark`), as palette names are.
  const flavor = typeof spec.flavor === "string" ? (spec.flavor.toLowerCase() as typeof spec.flavor & string) : "light";
  if (!(PROTOMAPS_FLAVORS as readonly string[]).includes(flavor)) {
    throw new Error(
      `The Protomaps basemap has no flavor "${String(flavor)}"; use one of ${PROTOMAPS_FLAVORS.join(", ")}.`
    );
  }
  if (typeof spec.pmtiles !== "string" || spec.pmtiles === "") {
    throw new Error("The Protomaps basemap needs pmtiles: (the path or URL of a .pmtiles file).");
  }
  const resolve = (url: string) => (options.pageUrl ? absolutizeTileTemplate(url, options.pageUrl) : url);
  // The generator is an on-demand chunk (formats/decoders); a download
  // failure rejects with a FormatError (code "chunk").
  const lib = await getDecoder("protomaps-basemap");
  return {
    version: 8,
    glyphs: typeof spec.glyphs === "string" ? resolve(spec.glyphs) : PROTOMAPS_GLYPHS,
    sprite: typeof spec.sprite === "string" ? resolve(spec.sprite) : protomapsSprite(flavor),
    sources: {
      [PROTOMAPS_SOURCE_ID]: {
        type: "vector",
        url: protomapsTilesUrl(spec.pmtiles, options.pageUrl),
        attribution: PROTOMAPS_ATTRIBUTION,
      },
    },
    layers: lib.layers(PROTOMAPS_SOURCE_ID, lib.namedFlavor(flavor), {
      lang: basemapLanguage(spec, options.pageLanguage),
    }),
  };
}

/**
 * Start downloading what a Protomaps basemap needs (the style generator and
 * the PMTiles reader) when `basemap` is one, as soon as the document is
 * known: the basemap is on the critical path to the first frame. Never
 * rejects; the renderer reports a failure when it awaits them.
 */
export function prefetchProtomapsBasemap(basemap: unknown): void {
  if (!protomapsBasemapOf(basemap)) return;
  prefetchDecoder("protomaps-basemap");
  prefetchDecoder("pmtiles");
}

/**
 * A stand-in style for when the basemap can't be built (its generator
 * didn't download): a plain background, so the document's own layers still
 * draw. `glyphs` stays, so the document's text layers keep working.
 */
export function fallbackBasemapStyle(spec: Pick<ProtomapsBasemap, "glyphs">, pageUrl?: string): Record<string, unknown> {
  const glyphs =
    typeof spec.glyphs === "string" ? (pageUrl ? absolutizeTileTemplate(spec.glyphs, pageUrl) : spec.glyphs) : PROTOMAPS_GLYPHS;
  return {
    version: 8,
    glyphs,
    sources: {},
    layers: [{ id: "background", type: "background", paint: { "background-color": "#eeeeee" } }],
  };
}

/**
 * When the file behind a Protomaps basemap is some other kind of PMTiles
 * (its own `vector_layers` lack the basemap's), the message to show;
 * otherwise `undefined`. A raster archive has no vector layers at all.
 *
 * @param vectorLayerIds - The archive's layer ids (from its metadata), or
 *   `undefined` when the archive declared none.
 * @param url - The `pmtiles://` URL the source reads.
 */
export function notAProtomapsBasemap(vectorLayerIds: readonly string[] | undefined, url: string): string | undefined {
  const ids = vectorLayerIds ?? [];
  const missing = BASEMAP_TILE_LAYERS.filter((id) => !ids.includes(id));
  if (missing.length === 0) return undefined;
  const has =
    ids.length > 0
      ? `its layers are ${ids.slice(0, 6).join(", ")}${ids.length > 6 ? ", …" : ""}`
      : "it has no vector layers";
  return (
    `\`${fileOf(url)}\` doesn't look like a Protomaps basemap: ${has}, while a Protomaps basemap ` +
    "has earth, water, roads and places. Use a Protomaps basemap file there (for example one cut " +
    "with `pmtiles extract` from https://build.protomaps.com). To draw this file's own data, add " +
    "it as a source and give it layers instead."
  );
}
