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
 * - at the bottom, room for MapLibre's bottom controls — the attribution,
 *   and a scale bar or logo in the same corner — measured on the map when
 *   they are there ({@link bottomControlsReserve}), with the attribution
 *   counted EXPANDED: on a narrow map it collapses to an (i) button, and a
 *   reader who taps it shouldn't then find the data under it. Before the
 *   controls exist, calibrated constants for MapLibre's own control stand in
 *   ({@link ATTRIBUTION_RESERVE_NARROW}, {@link ATTRIBUTION_RESERVE_WIDE}).
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
/** Below this width MapLibre's attribution is compact (an (i) button that expands). */
export const NARROW_MAP_WIDTH = 640;

/**
 * The bottom room MapLibre's compact attribution takes on a narrow map when
 * expanded: two lines of a typical basemap's credits (44 px) plus the
 * control's 10 px inset — measured on the real control at 356, 360 and
 * 390 px, on maplibre-gl 4, 5 and 6.
 */
export const ATTRIBUTION_RESERVE_NARROW = 54;
/** The same on a wide map: one line, expanded, plus the inset (measured at 1280 px). */
export const ATTRIBUTION_RESERVE_WIDE = 34;

/**
 * The default `fitTo` padding for a map of this size (CSS pixels).
 *
 * @param bottomReserve - The bottom room the map's controls take, when
 *   measured ({@link bottomControlsReserve}); else the calibrated constants.
 */
export function defaultFitPadding(width: number, height: number, bottomReserve?: number): FitPadding {
  const short = Math.min(width, height);
  const base = Math.round(Math.min(FIT_PADDING_MAX, Math.max(FIT_PADDING_MIN, short * 0.08)));
  const attribution =
    bottomReserve ?? (width < NARROW_MAP_WIDTH ? ATTRIBUTION_RESERVE_NARROW : ATTRIBUTION_RESERVE_WIDE);
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
  size: { width: number; height: number; bottomReserve?: number | undefined }
): number | FitPadding {
  return fitTo.padding !== undefined
    ? fitTo.padding
    : defaultFitPadding(size.width, size.height, size.bottomReserve);
}

/**
 * The room MapLibre's controls take at the bottom of a map, measured: the
 * taller of the two bottom corners' control stacks (attribution, scale bar,
 * logo, with their insets), the compact attribution counted expanded — it is
 * expanded for the measurement only, within one task, so nothing is painted
 * in between. `undefined` when no attribution has its credits yet (the
 * style hasn't loaded): the constants are the better guess then.
 *
 * @param container - The map's container element.
 */
export function bottomControlsReserve(container: HTMLElement | null | undefined): number | undefined {
  if (!container || typeof container.querySelectorAll !== "function") return undefined;
  const box = container.getBoundingClientRect();
  if (box.height <= 0) return undefined;
  const attributions = [...container.querySelectorAll<HTMLElement>(".maplibregl-ctrl-attrib")];
  const credits = (a: HTMLElement) => (a.querySelector(".maplibregl-ctrl-attrib-inner")?.textContent ?? "").trim();
  if (attributions.length === 0 || !attributions.some((a) => credits(a) !== "")) return undefined;
  const expanded: HTMLElement[] = [];
  for (const a of attributions) {
    if (a.classList.contains("maplibregl-compact") && !a.classList.contains("maplibregl-compact-show")) {
      a.classList.add("maplibregl-compact-show");
      expanded.push(a);
    }
  }
  try {
    let reserve = 0;
    for (const corner of container.querySelectorAll<HTMLElement>(".maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right")) {
      for (const control of corner.children) {
        const rect = control.getBoundingClientRect();
        if (rect.height > 0) reserve = Math.max(reserve, box.bottom - rect.top);
      }
    }
    return Math.ceil(reserve);
  } finally {
    for (const a of expanded) a.classList.remove("maplibregl-compact-show");
  }
}
