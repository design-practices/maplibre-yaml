/**
 * Utility functions for maplibre-yaml.
 *
 * @module utils
 */

// HTML escaping and URL guards -- the shared sinks-safety helpers. Exported
// so consumers rendering their own chrome around a map (the Astro components
// do exactly this) escape the same way core does.
export { escapeHtml, safeUrl, POPUP_TAGS, LINK_TARGETS } from "./html";

// Event emitter
export { EventEmitter } from "./event-emitter";
export type { EventHandler } from "./event-emitter";

// Config resolution
export {
  resolveMapConfig,
  resolveMapBlock,
  isMapConfigComplete,
  createSimpleMapConfig,
  ConfigResolutionError,
} from "./config-resolver";

/**
 * Deep merge two objects.
 */
export function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const output = { ...target };

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== undefined &&
      typeof sourceValue === "object" &&
      sourceValue !== null &&
      !Array.isArray(sourceValue) &&
      typeof targetValue === "object" &&
      targetValue !== null &&
      !Array.isArray(targetValue)
    ) {
      output[key] = deepMerge(
        targetValue as object,
        sourceValue as object
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      output[key] = sourceValue as T[keyof T];
    }
  }

  return output;
}

/**
 * Check if value is a plain object.
 */
export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && value.constructor === Object
  );
}
