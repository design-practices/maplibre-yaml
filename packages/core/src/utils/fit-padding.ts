/**
 * @file The padding `fitTo` frames the data with when the author gives none (0.9, ml-aot.124)
 * @module @maplibre-yaml/core/utils/fit-padding
 *
 * @description
 * Fitting a camera to data's exact extent puts the outermost features on the
 * map's edges: a circle or an icon there is cut in half, and on a narrow map
 * the bottom one hides under MapLibre's attribution, which starts expanded
 * (ml-aot.112). Without `padding:`, `fitTo` keeps a margin instead:
 *
 * - on every side, 8% of the map's shorter side, between 12 and 48 pixels
 *   (48 on a desktop map, about 30 on a phone, so the data doesn't shrink
 *   on a small screen);
 * - at the bottom, room for the attribution too: 32 pixels on a map
 *   narrower than 640 pixels (its compact form, expanded), 16 otherwise
 *   (one line in the corner).
 *
 * An author's `padding:` (a number, the same on every side) is used as given.
 * Pure: the renderer passes the map's size, the emitter its reference
 * viewport.
 */

/** MapLibre's `PaddingOptions`. */
export interface FitPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The smallest and largest default margin, in CSS pixels. */
export const FIT_PADDING_MIN = 12;
export const FIT_PADDING_MAX = 48;
/** Below this width MapLibre's attribution is compact (and starts expanded). */
export const NARROW_MAP_WIDTH = 640;

/** The default `fitTo` padding for a map of this size (CSS pixels). */
export function defaultFitPadding(width: number, height: number): FitPadding {
  const short = Math.min(width, height);
  const base = Math.round(Math.min(FIT_PADDING_MAX, Math.max(FIT_PADDING_MIN, short * 0.08)));
  const attribution = width < NARROW_MAP_WIDTH ? 32 : 16;
  const padding = { top: base, right: base, bottom: base + attribution, left: base };
  // Never more than half the map in either direction (MapLibre refuses a fit
  // that leaves no room): a very small map gets proportionally less.
  const fit = (a: number, b: number, size: number) => {
    const limit = size / 2;
    return a + b > limit && size > 0 ? limit / (a + b) : 1;
  };
  const sy = fit(padding.top, padding.bottom, height);
  const sx = fit(padding.left, padding.right, width);
  return {
    top: Math.floor(padding.top * sy),
    right: Math.floor(padding.right * sx),
    bottom: Math.floor(padding.bottom * sy),
    left: Math.floor(padding.left * sx),
  };
}

/**
 * The padding a `fitTo` frames with: the author's `padding:` when given,
 * else {@link defaultFitPadding} for the map's size.
 */
export function fitToPadding(
  fitTo: { padding?: number | undefined },
  size: { width: number; height: number }
): number | FitPadding {
  return fitTo.padding !== undefined ? fitTo.padding : defaultFitPadding(size.width, size.height);
}
