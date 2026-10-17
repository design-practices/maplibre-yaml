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
import { resolve as resolvePath } from "path";
import { parse as parseYAML } from "yaml";

// This loader calls `yaml`'s `parse` directly (in `loadYAML`/`loadFromGlob`)
// rather than delegating to core's `YAMLParser`, so it must parse with core's
// canonical options — imported, not re-declared. A local copy previously
// drifted from core: it carried `merge` but not the `!html` tag, so it silently
// dropped `!html` to a bare string here while core resolved it to `{ $html }`.
// Importing the single source of truth makes that drift structurally impossible.
import { YAMLParser, YAML_PARSE_OPTIONS } from "@maplibre-yaml/core";
import type { MapBlock, ScrollytellingBlock, ParseError } from "@maplibre-yaml/core";

/**
 * Error thrown when YAML loading or validation fails.
 *
 * @remarks
 * This error includes detailed validation errors with paths to help
 * developers identify and fix configuration issues.
 *
 * **Security note:** the optional ES2022 `cause` field may include
 * filesystem paths or parser internals. Strip `.cause` before forwarding
 * these errors to user-facing HTTP responses.
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
/**
 * One entry of {@link YAMLLoadError.errors}: core's `ParseError` (`path`,
 * `line`, `column`) with a self-describing `message` that names the file,
 * field and line (since 0.5.1), and the fields Astro's error overlay reads.
 */
export interface YAMLLoadIssue extends ParseError {
  /** Core's original message, without file, field or line ("Expected array, got undefined"). */
  reason?: string;
  /** Same as `message` (the field Astro 4/5's overlay reads). */
  text?: string;
  /** Where in the YAML file (Astro 7's overlay frames it). */
  loc?: { file: string; line: number; column: number };
  /** Same as `loc` (Astro 4/5's overlay). */
  location?: { file: string; line: number; column: number };
}

export class YAMLLoadError extends Error {
  /**
   * Array of validation errors with paths and messages.
   *
   * **Only assigned when non-empty** -- Astro's `collectErrorMetadata`
   * treats any thrown error with `Array.isArray(e.errors)` as an aggregate
   * and unpacks it; an empty array crashes the dev-overlay formatter.
   * Omitting the property when there are no structured errors keeps
   * single-message throws compatible with Astro's error pipeline.
   */
  public errors?: YAMLLoadIssue[];

  /**
   * Path to the YAML file that failed to load
   */
  public filePath: string;

  constructor(
    message: string,
    filePath: string,
    errors: YAMLLoadIssue[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "YAMLLoadError";
    this.filePath = filePath;
    if (errors.length > 0) this.errors = errors;
  }
}

/** A validation finding as core's parser reports it (errors and warnings alike). */
interface Finding {
  path: string;
  message: string;
  line?: number;
  column?: number;
}

/** `chapters.2.center: Expected array, got undefined (line 81, column 5)` */
function describeFinding(finding: Finding): string {
  const where =
    finding.line !== undefined
      ? ` (line ${finding.line}${finding.column !== undefined ? `, column ${finding.column}` : ""})`
      : "";
  return `${finding.path ? `${finding.path}: ` : ""}${finding.message}${where}`;
}

/**
 * The error a failed `loadMapConfig` / `loadScrollytellingConfig` throws,
 * carrying what `mlym validate` would say (ml-aot.4).
 *
 * @remarks
 * Astro treats a thrown error whose `errors` is an array as an aggregate and
 * its dev overlay shows the FIRST ENTRY, not the top-level message: Astro 7
 * reads the entry's `message` and frames its `loc` (Oxc's shape), Astro 4/5
 * read `text` and `location` (esbuild's). Core's `ParseError` messages carry
 * no path, file or line, so the overlay used to read only "Expected array,
 * got undefined". Each entry is therefore a self-describing copy of the
 * ParseError:
 *
 * - `message` / `text` — `<file>: <field path>: <reason> (line L, column C)`,
 *   plus any parser warning on the same object (the unknown-key "did you
 *   mean" that usually explains a missing field); the first entry also
 *   counts the other errors;
 * - `reason` — core's original message, for programmatic use (`path`,
 *   `line` and `column` are unchanged);
 * - `loc` / `location` — `{ file, line, column }` in the YAML file, so the
 *   overlay shows a code frame of the offending line.
 *
 * The top-level `message` lists every error and warning, for `astro build`
 * and logs.
 */
function validationError(
  what: string,
  path: string,
  errors: ParseError[],
  warnings: Finding[] = []
): YAMLLoadError {
  const lines = [
    ...errors.map((e) => `  error   ${describeFinding(e)}`),
    ...warnings.map((w) => `  warning ${describeFinding(w)}`),
  ];
  const message = `${what} validation failed for ${path}:\n${lines.join("\n")}`;
  const file = resolvePath(path);
  const parentOf = (p: string) => p.split(".").slice(0, -1).join(".");
  const entries = errors.map((error, index) => {
    const related = warnings
      .filter((w) => parentOf(w.path) === parentOf(error.path))
      .map((w) => ` Warning: ${describeFinding(w)}`)
      .join("");
    const more =
      index === 0 && errors.length > 1
        ? ` (+${errors.length - 1} more: ${errors
            .slice(1)
            .map((e) => e.path || "(root)")
            .join(", ")})`
        : "";
    const text = `${path}: ${describeFinding(error)}.${related}${more}`;
    // Oxc's `loc` (Astro 7) counts columns from 1, esbuild's `location`
    // (Astro 4/5) from 0.
    const where =
      error.line !== undefined
        ? {
            loc: { file, line: error.line, column: error.column ?? 1 },
            location: { file, line: error.line, column: Math.max(0, (error.column ?? 1) - 1) },
          }
        : {};
    return {
      ...error,
      reason: error.message,
      message: text,
      text,
      ...where,
    };
  });
  return new YAMLLoadError(message, path, entries);
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
      parsed = parseYAML(contents, YAML_PARSE_OPTIONS);
    } catch (error) {
      throw new YAMLLoadError(
        `YAML syntax error: ${error instanceof Error ? error.message : String(error)}`,
        path,
        [],
        { cause: error },
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
          error instanceof Error ? [{ path: "", message: error.message }] : [],
          { cause: error },
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
      path,
      [],
      { cause: error },
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
      throw validationError("Map configuration", path, result.errors, result.warnings);
    }

    return result.data!;
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
      path,
      [],
      { cause: error },
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
      throw validationError("Scrollytelling configuration", path, result.errors, result.warnings);
    }

    return result.data!;
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
      path,
      [],
      { cause: error },
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
        parsed = parseYAML(contents, YAML_PARSE_OPTIONS);
      } catch (error) {
        throw new YAMLLoadError(
          `YAML syntax error: ${error instanceof Error ? error.message : String(error)}`,
          path,
          [],
          { cause: error },
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
        errors.push({ path: error.filePath, errors: error.errors ?? [] });
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
        const errList = errs.map((e) => `  ${describeFinding(e)}`).join("\n");
        return `${path}:\n${errList}`;
      })
      .join("\n\n");
    const message = `Failed to load ${errors.length} file(s):\n${errorMessage}`;

    // Self-describing entries: Astro's overlay shows the first entry of an
    // `errors` array, not this message (see validationError).
    const flat = errors.flatMap(({ path, errors: errs }) => errs.map((e) => ({ file: path, e })));
    const entries = flat.map(({ file, e }, index) => {
      const more = index === 0 && flat.length > 1 ? ` (+${flat.length - 1} more; see the build log)` : "";
      const text = `${file}: ${describeFinding(e)}${more}`;
      return { ...e, reason: e.message, message: text, text };
    });
    throw new YAMLLoadError(message, "multiple files", entries);
  }

  return results;
}
