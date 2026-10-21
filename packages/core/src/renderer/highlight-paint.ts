/**
 * @file `hover.highlight` paint: the feature-state `case` around a layer's colour
 * @module @maplibre-yaml/core/renderer/highlight-paint
 *
 * @description
 * `hover.highlight: true` is only visible if a paint property reads the
 * hover feature-state, so the layer's primary colour is wrapped:
 * `["case", ["boolean", ["feature-state", "hover"], false], <highlight>, <colour>]`.
 *
 * A literal colour is wrapped as authored. A colour `classify:` generated is
 * wrapped the same way — the library wrote that expression, so it knows the
 * wrap is sound (the `case` only reads feature-state, which every colour
 * property we highlight through accepts) — and re-wrapped each time computed
 * breaks land. An author's own expression is left alone (see
 * LayerManager's `applyHighlightPaint`).
 *
 * maplibre-gl free, so the classify runtime can use it.
 */

import { HOVER_FEATURE_STATE_KEY } from "../interactions/built-ins";
import { classifyRecordOf } from "../classify/compile";

/**
 * The paint property each layer type highlights through.
 *
 * @remarks
 * Types absent here (heatmap, raster, hillshade, background) have no
 * per-feature color to drive, so highlight does not apply to them.
 */
export const HIGHLIGHT_PAINT_PROPERTY: Readonly<Record<string, string>> = {
  circle: "circle-color",
  line: "line-color",
  fill: "fill-color",
  "fill-extrusion": "fill-extrusion-color",
  symbol: "text-color",
};

/**
 * Colour a highlighted feature takes.
 *
 * @remarks
 * `hover.highlight` is a boolean, so the colour cannot be authored. Authors who
 * want control write their own `["feature-state", "hover"]` paint expression
 * instead, which the rewrite deliberately leaves untouched.
 */
export const HIGHLIGHT_COLOR = "#ffd700";

const HOVER_TEST = ["boolean", ["feature-state", HOVER_FEATURE_STATE_KEY], false];

/** Whether a layer asks for hover highlighting. */
export function isHighlightEnabled(layer: unknown): boolean {
  const interactive = (layer as { interactive?: { hover?: { highlight?: unknown } } } | null)
    ?.interactive;
  return interactive?.hover?.highlight === true;
}

/** `value` behind the hover `case`: the highlight colour while hovered. */
export function withHighlight(value: unknown): unknown[] {
  return ["case", HOVER_TEST, HIGHLIGHT_COLOR, value];
}

/** Whether `value` is already the hover `case` {@link withHighlight} writes. */
export function isHighlightWrapped(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value[0] === "case" &&
    value.length === 4 &&
    JSON.stringify(value[1]) === JSON.stringify(HOVER_TEST) &&
    value[2] === HIGHLIGHT_COLOR
  );
}

/**
 * The paint property a highlighted layer's colour is wrapped in when
 * `classify:` generated it — or undefined (no highlight, or classify drives
 * another property, or none).
 */
export function classifiedHighlightProperty(layer: unknown): string | undefined {
  if (!isHighlightEnabled(layer)) return undefined;
  const type = (layer as { type?: unknown }).type;
  const property = typeof type === "string" ? HIGHLIGHT_PAINT_PROPERTY[type] : undefined;
  const record = classifyRecordOf(layer);
  return property && record?.property === property ? property : undefined;
}
