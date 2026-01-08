/**
 * @file YAML loading utilities for Astro components
 * @module @maplibre-yaml/astro/utils/loader
 *
 * @description
 * Utilities for loading and validating YAML configuration files at build time.
 * These functions are designed to be used in Astro component frontmatter to
 * load configurations during the build process.
 *
 * ## Key Features
 *
 * - **Type-safe loading** - Validates YAML against schemas
 * - **Build-time execution** - Loads files during Astro build
 * - **Error reporting** - Detailed validation errors with paths
 * - **Glob support** - Load multiple files at once
 *
 * @example Basic usage
 * ```astro
 * ---
 * import { Map, loadMapConfig } from '@maplibre-yaml/astro';
 * const config = await loadMapConfig('./src/configs/map.yaml');
 * ---
 * <Map config={config} />
 * ```
 *
 * @example Loading multiple configs
 * ```astro
 * ---
 * import { loadFromGlob } from '@maplibre-yaml/astro/utils';
 * import { MapBlockSchema } from '@maplibre-yaml/core/schemas';
 *
 * const configs = await loadFromGlob(
 *   import.meta.glob('./src/configs/*.yaml', { as: 'raw' }),
 *   MapBlockSchema
 * );
 * ---
 * ```
 */

import { readFile } from "fs/promises";
import { parse as parseYAML } from "yaml";
import { YAMLParser } from "@maplibre-yaml/core";
import type { MapBlock, ScrollytellingBlock, ParseError } from "@maplibre-yaml/core";

/**
 * Error thrown when YAML loading or validation fails.
 *
 * @remarks
 * This error includes detailed validation errors with paths to help
 * developers identify and fix configuration issues.
 *
 * @example
 * ```typescript
 * try {
 *   const config = await loadMapConfig('./bad-config.yaml');
 * } catch (error) {
 *   if (error instanceof YAMLLoadError) {
 *     console.error('Validation errors:', error.errors);
 *   }
 * }
 * ```
 */
export class YAMLLoadError extends Error {
  /**
   * Array of validation errors with paths and messages
   */
  public errors: ParseError[];

  /**
   * Path to the YAML file that failed to load
   */
  public filePath: string;

  constructor(message: string, filePath: string, errors: ParseError[] = []) {
    super(message);
    this.name = "YAMLLoadError";
    this.filePath = filePath;
    this.errors = errors;
  }
}

/**
 * Load and parse a YAML file with optional schema validation.
 *
 * @param path - Absolute or relative path to YAML file
 * @param schema - Optional Zod schema for validation
 * @returns Parsed and validated configuration object
 * @throws {YAMLLoadError} If file cannot be read or validation fails
 *
 * @remarks
 * This is a generic loader that can be used with any YAML file and
 * optional Zod schema. For map and scrollytelling configs, use the
 * specialized loaders {@link loadMapConfig} and {@link loadScrollytellingConfig}.
 *
 * ## File Path Resolution
 *
 * - Absolute paths: Used as-is
 * - Relative paths: Resolved from current working directory
 * - Paths must be accessible at build time
 *
 * @example Basic YAML loading
 * ```typescript
 * import { loadYAML } from '@maplibre-yaml/astro/utils';
 *
 * interface MyConfig {
 *   title: string;
 *   items: string[];
 * }
 *
 * const config = await loadYAML<MyConfig>('./config.yaml');
 * ```
 *
 * @example With schema validation
 * ```typescript
 * import { loadYAML } from '@maplibre-yaml/astro/utils';
 * import { z } from 'zod';
 *
 * const schema = z.object({
 *   title: z.string(),
 *   count: z.number()
 * });
 *
 * const config = await loadYAML('./config.yaml', schema);
 * ```
 */
export async function loadYAML<T = unknown>(
  path: string,
  schema?: { parse: (data: unknown) => T }
): Promise<T> {
  try {
    // Read file contents
    const contents = await readFile(path, "utf-8");

    // Parse YAML
    let parsed: unknown;
    try {
      parsed = parseYAML(contents);
    } catch (error) {
      throw new YAMLLoadError(
        `YAML syntax error: ${error instanceof Error ? error.message : String(error)}`,
        path
      );
    }

    // Validate with schema if provided
    if (schema) {
      try {
        return schema.parse(parsed);
      } catch (error) {
        throw new YAMLLoadError(
          `Validation failed for ${path}`,
          path,
          error instanceof Error ? [{ path: "", message: error.message }] : []
        );
      }
    }

    return parsed as T;
  } catch (error) {
    // Re-throw YAMLLoadError as-is
    if (error instanceof YAMLLoadError) {
      throw error;
    }

    // Wrap other errors
    throw new YAMLLoadError(
      `Failed to load ${path}: ${error instanceof Error ? error.message : String(error)}`,
      path
    );
  }
}

/**
 * Load and validate a map configuration from YAML file.
 *
 * @param path - Path to YAML file containing map configuration
 * @returns Validated MapBlock configuration
 * @throws {YAMLLoadError} If file cannot be read or validation fails
 *
 * @remarks
 * This function loads a YAML file and validates it against the MapBlockSchema
 * from @maplibre-yaml/core. It ensures the configuration is valid before
 * returning it.
 *
 * ## Validation
 *
 * - Validates all required fields (type, id, config)
 * - Checks map configuration (center, zoom, mapStyle)
 * - Validates layer definitions
 * - Validates source definitions
 *
 * @example In Astro component
 * ```astro
 * ---
 * import { Map, loadMapConfig } from '@maplibre-yaml/astro';
 * const config = await loadMapConfig('./src/configs/earthquake-map.yaml');
 * ---
 * <Map config={config} height="500px" />
 * ```
 *
 * @example With error handling
 * ```astro
 * ---
 * import { loadMapConfig, YAMLLoadError } from '@maplibre-yaml/astro/utils';
 *
 * let config;
 * try {
 *   config = await loadMapConfig('./src/configs/map.yaml');
 * } catch (error) {
 *   if (error instanceof YAMLLoadError) {
 *     console.error('Validation errors:');
 *     error.errors.forEach(e => console.error(`  ${e.path}: ${e.message}`));
 *   }
 *   throw error;
 * }
 * ---
 * <Map config={config} />
 * ```
 */
export async function loadMapConfig(path: string): Promise<MapBlock> {
  try {
    // Read file contents
    const contents = await readFile(path, "utf-8");

    // Parse and validate using YAMLParser
    const result = YAMLParser.safeParseMapBlock(contents);

    if (!result.success) {
      throw new YAMLLoadError(
        `Map configuration validation failed for ${path}`,
        path,
        result.errors
      );
    }

    return result.data;
  } catch (error) {
    // Re-throw YAMLLoadError as-is
    if (error instanceof YAMLLoadError) {
      throw error;
    }

    // Wrap other errors
    throw new YAMLLoadError(
      `Failed to load map config from ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      path
    );
  }
}

/**
 * Load and validate a scrollytelling configuration from YAML file.
 *
 * @param path - Path to YAML file containing scrollytelling configuration
 * @returns Validated ScrollytellingBlock configuration
 * @throws {YAMLLoadError} If file cannot be read or validation fails
 *
 * @remarks
 * This function loads a YAML file and validates it against the
 * ScrollytellingBlockSchema from @maplibre-yaml/core. It ensures all
 * chapters, actions, and configurations are valid.
 *
 * ## Validation
 *
 * - Validates base map configuration
 * - Checks all chapters have required fields (id, title, center, zoom)
 * - Validates chapter actions (onChapterEnter, onChapterExit)
 * - Ensures at least one chapter is present
 * - Validates layer definitions
 *
 * @example In Astro component
 * ```astro
 * ---
 * import { Scrollytelling, loadScrollytellingConfig } from '@maplibre-yaml/astro';
 * const config = await loadScrollytellingConfig('./src/stories/climate.yaml');
 * ---
 * <Scrollytelling config={config} />
 * ```
 *
 * @example Multiple stories
 * ```astro
 * ---
 * import { loadScrollytellingConfig } from '@maplibre-yaml/astro/utils';
 *
 * const stories = {
 *   earthquakes: await loadScrollytellingConfig('./src/stories/earthquakes.yaml'),
 *   climate: await loadScrollytellingConfig('./src/stories/climate.yaml'),
 *   urban: await loadScrollytellingConfig('./src/stories/urban.yaml')
 * };
 * ---
 * ```
 */
export async function loadScrollytellingConfig(
  path: string
): Promise<ScrollytellingBlock> {
  try {
    // Read file contents
    const contents = await readFile(path, "utf-8");

    // Parse and validate using YAMLParser
    const result = YAMLParser.safeParseScrollytellingBlock(contents);

    if (!result.success) {
      throw new YAMLLoadError(
        `Scrollytelling configuration validation failed for ${path}`,
        path,
        result.errors
      );
    }

    return result.data;
  } catch (error) {
    // Re-throw YAMLLoadError as-is
    if (error instanceof YAMLLoadError) {
      throw error;
    }

    // Wrap other errors
    throw new YAMLLoadError(
      `Failed to load scrollytelling config from ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      path
    );
  }
}

/**
 * Load multiple YAML configurations using Astro's glob import.
 *
 * @param globResult - Result from import.meta.glob with { as: 'raw' }
 * @param validator - Optional validation function (e.g., YAMLParser.safeParseMapBlock)
 * @returns Array of loaded configurations with their paths
 * @throws {YAMLLoadError} If any file fails to load or validate
 *
 * @remarks
 * This function works with Astro's `import.meta.glob` to load multiple
 * YAML files at once during the build process. It's useful for loading
 * collections of map configs or stories.
 *
 * ## Usage Pattern
 *
 * 1. Use `import.meta.glob` with `{ as: 'raw' }` to get file contents
 * 2. Pass the result to `loadFromGlob`
 * 3. Optionally provide a validator function
 * 4. Receive array of parsed configs with paths
 *
 * @example Load all map configs
 * ```astro
 * ---
 * import { loadFromGlob } from '@maplibre-yaml/astro/utils';
 * import { YAMLParser } from '@maplibre-yaml/core';
 *
 * const configFiles = import.meta.glob('./src/configs/*.yaml', { as: 'raw' });
 * const configs = await loadFromGlob(
 *   configFiles,
 *   (yaml) => YAMLParser.safeParseMapBlock(yaml)
 * );
 * ---
 * <div>
 *   {configs.map(({ path, config }) => (
 *     <div>
 *       <h2>{path}</h2>
 *       <Map config={config} />
 *     </div>
 *   ))}
 * </div>
 * ```
 *
 * @example Load without validation
 * ```astro
 * ---
 * const yamlFiles = import.meta.glob('./src/data/*.yaml', { as: 'raw' });
 * const data = await loadFromGlob(yamlFiles);
 * ---
 * ```
 */
export async function loadFromGlob<T = unknown>(
  globResult: Record<string, () => Promise<string> | string>,
  validator?: (yaml: string) => { success: boolean; data?: T; errors?: ParseError[] }
): Promise<Array<{ path: string; config: T }>> {
  const results: Array<{ path: string; config: T }> = [];
  const errors: Array<{ path: string; errors: ParseError[] }> = [];

  for (const [path, loader] of Object.entries(globResult)) {
    try {
      // Get the raw YAML content
      const contents = typeof loader === "function" ? await loader() : loader;

      // Parse YAML
      let parsed: unknown;
      try {
        parsed = parseYAML(contents);
      } catch (error) {
        throw new YAMLLoadError(
          `YAML syntax error: ${error instanceof Error ? error.message : String(error)}`,
          path
        );
      }

      // Validate if validator provided
      if (validator) {
        const result = validator(contents);
        if (!result.success) {
          errors.push({
            path,
            errors: result.errors || [{ path: "", message: "Validation failed" }],
          });
          continue;
        }
        results.push({ path, config: result.data as T });
      } else {
        results.push({ path, config: parsed as T });
      }
    } catch (error) {
      if (error instanceof YAMLLoadError) {
        errors.push({ path: error.filePath, errors: error.errors });
      } else {
        errors.push({
          path,
          errors: [
            {
              path: "",
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        });
      }
    }
  }

  // If any files failed, throw with all errors
  if (errors.length > 0) {
    const errorMessage = errors
      .map(({ path, errors: errs }) => {
        const errList = errs.map((e) => `  ${e.path}: ${e.message}`).join("\n");
        return `${path}:\n${errList}`;
      })
      .join("\n\n");

    throw new YAMLLoadError(
      `Failed to load ${errors.length} file(s):\n${errorMessage}`,
      "multiple files",
      errors.flatMap((e) => e.errors)
    );
  }

  return results;
}
