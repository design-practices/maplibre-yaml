/**
 * @file Configuration resolution utilities for maplibre-yaml
 * @module @maplibre-yaml/core/utils/config-resolver
 *
 * @description
 * Utilities for resolving map configurations with global config inheritance.
 * Enables maps to inherit default values from global configuration while
 * allowing per-map overrides.
 *
 * @example
 * ```typescript
 * import { resolveMapConfig, resolveMapBlock } from '@maplibre-yaml/core/utils';
 *
 * const globalConfig = {
 *   defaultMapStyle: 'https://demotiles.maplibre.org/style.json',
 *   theme: 'dark'
 * };
 *
 * const mapConfig = {
 *   center: [-74.006, 40.7128],
 *   zoom: 12
 *   // mapStyle will be inherited from globalConfig.defaultMapStyle
 * };
 *
 * const resolved = resolveMapConfig(mapConfig, globalConfig);
 * // resolved.mapStyle === 'https://demotiles.maplibre.org/style.json'
 * ```
 */

import type { MapConfig, GlobalConfig, MapBlock } from "../schemas";

/**
 * Error thrown when map configuration is invalid after resolution.
 */
export class ConfigResolutionError extends Error {
  constructor(message: string, public readonly missingFields: string[]) {
    super(message);
    this.name = "ConfigResolutionError";
  }
}

/**
 * Resolves a map configuration by applying global defaults.
 *
 * @param mapConfig - The map-specific configuration (may have optional fields)
 * @param globalConfig - Global configuration with defaults
 * @returns Resolved map configuration with all required fields
 * @throws {ConfigResolutionError} If required fields are missing after resolution
 *
 * @remarks
 * Resolution order (highest to lowest priority):
 * 1. Values explicitly set in mapConfig
 * 2. Values from globalConfig defaults
 * 3. Error (no silent fallbacks for center, zoom, or mapStyle)
 *
 * **Inherited Properties:**
 * - `mapStyle` ← `globalConfig.defaultMapStyle`
 * - `center` ← `globalConfig.defaultCenter`
 * - `zoom` ← `globalConfig.defaultZoom`
 *
 * @example Basic Resolution
 * ```typescript
 * const resolved = resolveMapConfig(
 *   { center: [0, 0], zoom: 5 },
 *   { defaultMapStyle: 'https://example.com/style.json' }
 * );
 * // resolved.mapStyle === 'https://example.com/style.json'
 * ```
 *
 * @example Inherit zoom/center from global
 * ```typescript
 * const resolved = resolveMapConfig(
 *   { mapStyle: 'https://example.com/style.json' },
 *   { defaultCenter: [-74.006, 40.7128], defaultZoom: 10 }
 * );
 * // resolved.center === [-74.006, 40.7128]
 * // resolved.zoom === 10
 * ```
 */
// Overload: with globalConfig, center/zoom can come from either source
export function resolveMapConfig(
  mapConfig: Partial<MapConfig>,
  globalConfig: GlobalConfig,
): MapConfig;
// Overload: without globalConfig, center/zoom are required in mapConfig
export function resolveMapConfig(
  mapConfig: Partial<MapConfig> & { center: [number, number]; zoom: number },
  globalConfig?: GlobalConfig,
): MapConfig;
// Implementation
export function resolveMapConfig(
  mapConfig: Partial<MapConfig>,
  globalConfig?: GlobalConfig,
): MapConfig {
  const center = mapConfig.center ?? globalConfig?.defaultCenter;
  const zoom = mapConfig.zoom ?? globalConfig?.defaultZoom;

  const resolved = {
    ...mapConfig,
    center,
    zoom,
    mapStyle: mapConfig.mapStyle ?? globalConfig?.defaultMapStyle,
    interactive: mapConfig.interactive ?? true,
    pitch: mapConfig.pitch ?? 0,
    bearing: mapConfig.bearing ?? 0,
  };

  // Validate all required fields -- no silent fallbacks
  const missingFields: string[] = [];

  if (!resolved.mapStyle) {
    missingFields.push("mapStyle");
  }
  if (resolved.center === undefined) {
    missingFields.push("center");
  }
  if (resolved.zoom === undefined) {
    missingFields.push("zoom");
  }

  if (missingFields.length > 0) {
    throw new ConfigResolutionError(
      `Map configuration is missing required fields: ${missingFields.join(
        ", ",
      )}. ` +
        "Either provide these fields in the map config or set defaults in global config " +
        "(e.g., config.defaultMapStyle, config.defaultCenter, config.defaultZoom).",
      missingFields,
    );
  }

  return resolved as MapConfig;
}

/**
 * Resolves a complete MapBlock by applying global defaults to its config.
 *
 * @param mapBlock - The map block with potentially incomplete config
 * @param globalConfig - Global configuration with defaults
 * @returns Resolved map block with complete configuration
 * @throws {ConfigResolutionError} If required fields are missing after resolution
 *
 * @remarks
 * This function resolves the `config` property of a MapBlock while preserving
 * all other block properties (layers, controls, legend, etc.).
 *
 * @example
 * ```typescript
 * const mapBlock = {
 *   type: 'map',
 *   id: 'my-map',
 *   config: { center: [0, 0], zoom: 5 },
 *   layers: [...]
 * };
 *
 * const resolved = resolveMapBlock(mapBlock, {
 *   defaultMapStyle: 'https://example.com/style.json'
 * });
 * // resolved.config.mapStyle === 'https://example.com/style.json'
 * ```
 */
export function resolveMapBlock(
  mapBlock: MapBlock,
  globalConfig?: GlobalConfig,
): MapBlock {
  return {
    ...mapBlock,
    config: resolveMapConfig(mapBlock.config, globalConfig),
  };
}

/**
 * Checks if a map configuration has all required fields.
 *
 * @param mapConfig - Map configuration to validate
 * @returns True if all required fields are present
 *
 * @remarks
 * Use this to check if a config needs resolution before rendering.
 *
 * @example
 * ```typescript
 * if (!isMapConfigComplete(config)) {
 *   config = resolveMapConfig(config, globalConfig);
 * }
 * ```
 */
export function isMapConfigComplete(
  mapConfig: Partial<MapConfig>,
): mapConfig is MapConfig {
  return (
    mapConfig.center !== undefined &&
    mapConfig.zoom !== undefined &&
    mapConfig.mapStyle !== undefined
  );
}

/**
 * Creates a map configuration with sensible defaults for simple use cases.
 *
 * @param options - Minimal configuration options
 * @param globalConfig - Optional global configuration for defaults
 * @returns Complete map configuration
 *
 * @remarks
 * This is a convenience function for creating simple map configurations
 * without needing to specify every field. Useful for collection items and
 * content-focused applications.
 *
 * **Default Values:**
 * - `zoom`: 12
 * - `pitch`: 0
 * - `bearing`: 0
 * - `interactive`: true
 *
 * @example Simple Location Map
 * ```typescript
 * const config = createSimpleMapConfig({
 *   center: [-74.006, 40.7128],
 *   mapStyle: 'https://example.com/style.json'
 * });
 * ```
 *
 * @example With Global Style
 * ```typescript
 * const config = createSimpleMapConfig(
 *   { center: [-74.006, 40.7128] },
 *   { defaultMapStyle: 'https://example.com/style.json' }
 * );
 * ```
 */
export function createSimpleMapConfig(
  options: {
    center: [number, number];
    zoom?: number;
    mapStyle?: string;
    pitch?: number;
    bearing?: number;
    interactive?: boolean;
  },
  globalConfig?: GlobalConfig,
): MapConfig {
  const config: Partial<MapConfig> & {
    center: [number, number];
    zoom: number;
  } = {
    center: options.center,
    zoom: options.zoom ?? 12,
    mapStyle: options.mapStyle,
    pitch: options.pitch ?? 0,
    bearing: options.bearing ?? 0,
    interactive: options.interactive ?? true,
  };

  return resolveMapConfig(config, globalConfig);
}
