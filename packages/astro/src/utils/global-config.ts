/**
 * @file Global config loader utility
 * @module @maplibre-yaml/astro/utils/global-config
 *
 * @description
 * Loads and validates a global map configuration from a YAML file.
 * Use this to define site-wide map defaults (style, zoom, center)
 * that are inherited by all map builders.
 *
 * @example
 * ```typescript
 * // src/lib/map-config.ts
 * import { loadGlobalMapConfig } from '@maplibre-yaml/astro';
 * export const globalConfig = await loadGlobalMapConfig('./src/config/maps.yaml');
 * ```
 */

import { GlobalConfigSchema } from "@maplibre-yaml/core/schemas";
import type { GlobalConfig } from "@maplibre-yaml/core/schemas";
import { loadYAML } from "./loader";

/**
 * Loads and validates a global map configuration from a YAML file.
 *
 * @param filePath - Path to the YAML configuration file
 * @returns Parsed and validated global configuration
 * @throws {Error} If the file cannot be read
 * @throws {ZodError} If the YAML content fails schema validation
 */
export async function loadGlobalMapConfig(
  filePath: string,
): Promise<GlobalConfig> {
  const raw = await loadYAML(filePath);
  return GlobalConfigSchema.parse(raw);
}
