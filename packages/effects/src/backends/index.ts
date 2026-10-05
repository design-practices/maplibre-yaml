/**
 * @file The rendering backends effects can choose
 * @module @maplibre-yaml/effects
 *
 * @description
 * A document never names a backend (R17): it is a property of the
 * registered effect. 0.7 ships one.
 *
 * @experimental
 */

import { extrusions } from "./extrusions/backend";

/** @experimental */
export const backends = {
  /** Shader effects on `fill-extrusion` layers (MapLibre custom layer, mercator only). */
  extrusions,
} as const;

export { extrusions };
