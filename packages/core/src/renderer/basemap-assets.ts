/**
 * @file What a Protomaps basemap needs besides its tiles (0.9, ml-cnv.16)
 * @module @maplibre-yaml/core/renderer/basemap-assets
 *
 * @description
 * A Protomaps basemap draws its labels with fonts (`glyphs:`) and its road
 * shields and points of interest with icons (`sprite:`), by default from
 * Protomaps' hosted copies on protomaps.github.io. Two things can go wrong
 * that MapLibre reports only on the console:
 *
 * - **The fonts or icons don't load** (the host blocked, offline, a
 *   self-hosted `glyphs:` path that 404s): labels fall back to a system font
 *   or vanish, icons and shields vanish. {@link basemapAssetProblem} (or,
 *   when the error doesn't name the file, {@link probeBasemapAssets}) turns
 *   the first such failure into one notice naming the host and the
 *   `glyphs:` / `sprite:` fix.
 * - **Right-to-left label languages** (`lang: ar`, `he`, `fa`, `ur`, or the
 *   page's language): maplibre-gl 6.9 and later shape Arabic and order
 *   bidirectional text themselves. Older ones need MapLibre's right-to-left
 *   text plugin, or the labels draw unjoined and reversed;
 *   {@link ensureRightToLeftLabels} sets it, lazily (it downloads only when a
 *   right-to-left label is about to be drawn), unless the page set one.
 *
 * Never imports maplibre-gl itself: the module comes from the interop.
 */

import { maplibregl, runtimeVersion } from "./maplibre-interop";

/** The Protomaps label languages written right to left. */
export const RIGHT_TO_LEFT_LANGUAGES: ReadonlySet<string> = new Set(["ar", "he", "fa", "ur"]);

/** The release that draws right-to-left text without a plugin. */
const BUILT_IN_RTL = [6, 9] as const;

/**
 * MapLibre's right-to-left text plugin for a maplibre-gl version, or
 * `undefined` when that version needs none: the URLs MapLibre's own examples
 * use (0.3.0 loads from maplibre-gl 5; 4.x needs 0.2.3).
 */
export function rightToLeftPluginUrl(version: string | undefined): string | undefined {
  const [major, minor] = (version ?? "").split(".").map(Number);
  if (!Number.isFinite(major) || !major) return undefined;
  if (major > BUILT_IN_RTL[0] || (major === BUILT_IN_RTL[0] && Number(minor) >= BUILT_IN_RTL[1])) return undefined;
  if (major >= 5) return "https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js";
  return "https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js";
}

interface RtlApi {
  setRTLTextPlugin?: (url: string, lazy: boolean) => Promise<void> | void;
  getRTLTextPluginStatus?: () => string;
}

/**
 * Let a basemap labelled in a right-to-left language draw correctly on a
 * maplibre-gl older than 6.9: set MapLibre's right-to-left text plugin,
 * lazily, unless the page already set one (or the version needs none).
 *
 * @param language - The basemap's label language.
 * @param onFailure - Told when the plugin couldn't be set or downloaded.
 * @returns The plugin URL set, or `undefined` when none was needed.
 */
export function ensureRightToLeftLabels(
  language: string,
  onFailure: (pluginUrl: string, error: unknown) => void
): string | undefined {
  if (!RIGHT_TO_LEFT_LANGUAGES.has(language)) return undefined;
  const url = rightToLeftPluginUrl(runtimeVersion());
  if (!url) return undefined;
  const gl = maplibregl as unknown as RtlApi;
  if (typeof gl.setRTLTextPlugin !== "function") return undefined;
  // The page's own plugin (or one set for an earlier map) wins.
  const status = gl.getRTLTextPluginStatus?.();
  if (status !== undefined && status !== "unavailable") return undefined;
  try {
    const pending = gl.setRTLTextPlugin(url, true);
    if (pending && typeof (pending as Promise<void>).catch === "function") {
      (pending as Promise<void>).catch((error: unknown) => onFailure(url, error));
    }
  } catch (error) {
    onFailure(url, error);
    return undefined;
  }
  return url;
}

/** The glyph and sprite URLs a Protomaps basemap's style uses, and whether they are the defaults. */
export interface BasemapAssets {
  glyphs: string;
  sprite: string;
  /** Protomaps' hosted fonts (no `glyphs:` given). */
  hostedGlyphs: boolean;
  /** Protomaps' hosted icons (no `sprite:` given). */
  hostedSprite: boolean;
}

/** The fixed part of a URL template (`…/fonts/{fontstack}/{range}.pbf` → `…/fonts/`). */
function prefixOf(template: string): string {
  const brace = template.indexOf("{");
  return brace === -1 ? template : template.slice(0, brace);
}

/** `https://protomaps.github.io/…` → `protomaps.github.io`. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Which of a basemap's assets a message is about. */
export type BasemapAsset = "glyphs" | "sprite";

/** How a basemap's missing assets are drawn around. */
export interface BasemapAssetOptions {
  /**
   * The basemap's labels were left out so the rest of it could draw
   * (maplibre-gl 4 draws no basemap tile at all without its fonts).
   */
  labelsHidden?: boolean;
}

/**
 * The notice for a basemap's fonts (`glyphs`) and/or icons (`sprite`) that
 * didn't load: the host when they are Protomaps' hosted copies, the path
 * when they are the author's.
 */
export function basemapAssetMessage(
  failed: BasemapAsset | readonly BasemapAsset[],
  assets: BasemapAssets,
  options: BasemapAssetOptions = {}
): string {
  const which = new Set(typeof failed === "string" ? [failed] : failed);
  const glyphs = which.has("glyphs");
  const sprite = which.has("sprite");
  const effect = options.labelsHidden
    ? "The basemap's labels are left out so the rest of it can draw (maplibre-gl 4 draws no basemap without its fonts)" +
      (sprite ? ", and its icons and road shields are missing." : ".")
    : glyphs && sprite
      ? "Labels may show in a fallback font, and icons and road shields are missing."
      : glyphs
        ? "Labels may show in a fallback font or not at all."
        : "Icons and road shields are missing.";
  const hosted = [...which].some((w) => (w === "glyphs" ? assets.hostedGlyphs : assets.hostedSprite));
  if (hosted) {
    const host = hostOf(glyphs && assets.hostedGlyphs ? assets.glyphs : assets.sprite);
    const what = glyphs && sprite ? "labels and icons" : glyphs ? "labels" : "icons";
    const from = glyphs && sprite ? "its fonts and icons come" : glyphs ? "its fonts come" : "its icons come";
    return (
      `The basemap's ${what} couldn't load: ${from} from ${host}, which this page couldn't reach. ${effect} ` +
      "To serve your own copies, set `glyphs:` and `sprite:` in the basemap (the Protomaps basemaps-assets " +
      "fonts and sprites, copied to your site)."
    );
  }
  const parts = [
    ...(glyphs ? [`fonts (\`glyphs: ${assets.glyphs}\`)`] : []),
    ...(sprite ? [`icons (\`sprite: ${assets.sprite}\`)`] : []),
  ];
  const keys = [...(glyphs ? ["`glyphs:`"] : []), ...(sprite ? ["`sprite:`"] : [])].join(" and ");
  return (
    `The basemap's ${parts.join(" and ")} couldn't load. ${effect} Check the path in ${keys} and that the ` +
    "files are on your site."
  );
}

/**
 * When a MapLibre error names a basemap font or icon file that didn't load
 * (maplibre-gl 5 and later put the URL in a sprite error), the notice to
 * show; otherwise `undefined`. {@link probeBasemapAssets} is the general check.
 *
 * @param message - The error's message.
 */
export function basemapAssetProblem(message: string, assets: BasemapAssets): string | undefined {
  if (assets.glyphs && message.includes(prefixOf(assets.glyphs))) return basemapAssetMessage("glyphs", assets);
  if (assets.sprite && message.includes(prefixOf(assets.sprite))) return basemapAssetMessage("sprite", assets);
  return undefined;
}

/** The first glyph range of the font every Protomaps flavor labels with. */
export function glyphProbeUrl(template: string): string {
  return template.replace("{fontstack}", encodeURIComponent("Noto Sans Regular")).replace("{range}", "0-255");
}

/**
 * Which of a basemap's assets can't be fetched, asked directly. MapLibre
 * reports a font that didn't load only as a console warning (maplibre-gl 5
 * and later) or as a tile error naming no file (4), and a sprite on 4 as a
 * bare "Failed to fetch". The browser's cache answers when MapLibre fetched
 * them already.
 *
 * @returns The assets that failed (empty when both load).
 */
export async function probeBasemapAssets(assets: BasemapAssets): Promise<BasemapAsset[]> {
  const loads = async (url: string) => {
    try {
      const response = await fetch(url);
      void response.body?.cancel().catch(() => undefined);
      return response.ok;
    } catch {
      return false;
    }
  };
  const [glyphs, sprite] = await Promise.all([
    assets.glyphs ? loads(glyphProbeUrl(assets.glyphs)) : Promise.resolve(true),
    assets.sprite ? loads(`${assets.sprite}.json`) : Promise.resolve(true),
  ]);
  return [...(glyphs ? [] : (["glyphs"] as const)), ...(sprite ? [] : (["sprite"] as const))];
}
