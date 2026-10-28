/**
 * @file YAML, JSON and TOML loading utilities for Astro components
 * @module @maplibre-yaml/astro/utils/loader
 *
 * @description
 * Utilities for loading and validating map and story documents at build time.
 * These functions are designed to be used in Astro component frontmatter to
 * load configurations during the build process.
 *
 * ## Key Features
 *
 * - **Three formats** - YAML, JSON or TOML, chosen by the file's extension
 *   (`.yaml`/`.yml`, `.json`, `.toml`); a file with another extension is
 *   read by its content
 * - **Type-safe loading** - Validates documents against schemas
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

import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { resolve as resolvePath } from "path";
import { parse as parseYAML } from "yaml";

// Every document read here goes through core's front door,
// `parseDocumentText`, which picks the format by the file's extension and
// words its errors for that format ("TOML syntax error: …"). A copy of the
// parse options once drifted from core here (it dropped the `!html` tag), so
// the loader keeps no reading rules of its own. The one direct `yaml` parse
// left is `readValue`'s raw read of a file `loadYAML`/`loadFromGlob` return
// unvalidated (any data, not only documents), after the front door has read
// it, with core's canonical `YAML_PARSE_OPTIONS` imported, never re-declared.
import {
  YAML_PARSE_OPTIONS,
  convertDocument,
  displayPath,
  parseDocumentText,
} from "@maplibre-yaml/core";
import { trackFile } from "./dev-watch";
import type {
  DocumentFormat,
  MapBlock,
  ScrollytellingBlock,
  ParseError,
} from "@maplibre-yaml/core";

/**
 * Error thrown when loading or validating a YAML, JSON or TOML file fails.
 * (The name predates JSON and TOML and is kept for compatibility.)
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
  /** Where in the file (Astro 7's overlay frames it). */
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
   * Path to the file that failed to load
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
  // Not "chapters.2.centre" next to a message that already says "Chapter 3",
  // as `mlym validate` and the story's error card print it (ml-aot.62).
  const path = displayPath(finding);
  return `${path ? `${path}: ` : ""}${finding.message}${where}`;
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
 * - `loc` / `location` — `{ file, line, column }` in the file, so the
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
  return new YAMLLoadError(message, path, overlayEntries(path, errors, warnings));
}

/**
 * The self-describing `errors` entries of {@link validationError}, which
 * Astro's overlay shows the first of (see there).
 */
function overlayEntries(path: string, errors: ParseError[], warnings: Finding[] = []): YAMLLoadIssue[] {
  const file = resolvePath(path);
  const parentOf = (p: string) => p.split(".").slice(0, -1).join(".");
  return errors.map((error, index) => {
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
}

/** Codes of the errors that mean the text could not be read at all. */
const UNREADABLE = new Set(["yaml-syntax", "toml-syntax", "yaml-expansion", "yaml-merge"]);

/**
 * Read a file's text as a plain value, in whichever format its name (or,
 * failing that, its content) says, without validating it as a document.
 *
 * @remarks
 * The front door reads the text first, so a syntax error is worded for its
 * format and carries its line and column, and YAML gets core's merge-key and
 * alias-expansion guards. The value then comes from the same canonical
 * options: YAML and JSON (which is YAML 1.2) are parsed with
 * `YAML_PARSE_OPTIONS`; TOML is converted by core's converter to YAML (dates
 * stay the text as written; `{"$html" = …}` becomes `!html`) and read back
 * the same way, so all three formats yield the same value for the same data.
 *
 * @throws {YAMLLoadError} When the text is not valid YAML, JSON or TOML.
 */
async function readValue(
  contents: string,
  path: string
): Promise<{ value: unknown; format: DocumentFormat }> {
  const read = await parseDocumentText(contents, { signals: { fileName: path } });
  const { format } = read;
  const unreadable = read.result.errors.filter((e) => e.code !== undefined && UNREADABLE.has(e.code));
  if (unreadable.length > 0) throw syntaxError(path, unreadable);

  const body = contents.charCodeAt(0) === 0xfeff ? contents.slice(1) : contents;
  if (format !== "toml") return { value: parseYAML(body, YAML_PARSE_OPTIONS), format };
  // An empty TOML file is an empty table.
  if (body.trim() === "") return { value: {}, format };
  const converted = await convertDocument(body, { from: "toml", to: "yaml" });
  if (!converted.success) {
    // A value TOML holds that YAML cannot (an integer past 2^53), by its path.
    throw syntaxError(
      path,
      converted.errors.map(({ path: at, message, line, column }) => ({ path: at, message, line, column }))
    );
  }
  return { value: parseYAML(converted.text, YAML_PARSE_OPTIONS), format };
}

/** `Could not read map.toml: TOML syntax error: … (line 3, column 7)`, as {@link validationError} frames it. */
function syntaxError(path: string, errors: ParseError[]): YAMLLoadError {
  const lines = errors.map((e) => `  error   ${describeFinding(e)}`);
  return new YAMLLoadError(`Could not read ${path}:\n${lines.join("\n")}`, path, overlayEntries(path, errors));
}

/**
 * Extra advice for a file that is not there (ENOENT).
 *
 * @remarks
 * The loaders read the file when the page RENDERS. In a static build that is
 * `astro build`, inside the project. With `output: 'server'` (or a page with
 * `prerender = false`) it is every request, on the deployed server -- which
 * usually has the built `dist/` and no `src/`, so a path that worked in
 * `astro dev` fails with a bare ENOENT and a 500 (ml-aot.27). When the
 * working directory has no `src/` at all, say what is going on.
 */
function missingFileHint(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code !== "ENOENT") return "";
  const cwd = process.cwd();
  const deployed = !existsSync(resolvePath(cwd, "src"));
  if (!deployed) {
    return `. The path is resolved from the project root (${cwd}); check the spelling.`;
  }
  return (
    `. This server's working directory (${cwd}) has no src/ folder, so this looks like a ` +
    `deployed server rendering the page on request (output: 'server'). The map loaders read ` +
    `files when the page renders: add \`export const prerender = true;\` to pages that call ` +
    `them so they are read once at build time, or import the YAML instead ` +
    `(\`import raw from '../maps/map.yaml?raw'\`) or use a content collection.`
  );
}

/**
 * Load and parse a YAML, JSON or TOML file with optional schema validation.
 *
 * @param path - Absolute or relative path to the file
 * @param schema - Optional Zod schema for validation
 * @returns Parsed and validated configuration object
 * @throws {YAMLLoadError} If file cannot be read or validation fails
 *
 * @remarks
 * This is a generic loader that can be used with any YAML, JSON or TOML file
 * and optional Zod schema; the extension picks the format (`.yaml`/`.yml`,
 * `.json`, `.toml`), and a syntax error names that format with its line and
 * column. For map and scrollytelling configs, use the
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
  // For the dev-reload integration (ml-aot.24): Vite never sees this read.
  trackFile(path);
  try {
    // Read file contents
    const contents = await readFile(path, "utf-8");

    // Parse in the file's format (a syntax error throws a YAMLLoadError)
    const { value: parsed } = await readValue(contents, path);

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
      `Failed to load ${path}: ${error instanceof Error ? error.message : String(error)}${missingFileHint(error)}`,
      path,
      [],
      { cause: error },
    );
  }
}

/**
 * Load and validate a map configuration from a YAML, JSON or TOML file.
 *
 * @param path - Path to the file containing the map configuration; its
 *   extension (`.yaml`/`.yml`, `.json`, `.toml`) picks the format
 * @returns Validated MapBlock configuration
 * @throws {YAMLLoadError} If file cannot be read or validation fails
 *
 * @remarks
 * This function loads a map document and validates it against the MapBlockSchema
 * from @maplibre-yaml/core, through core's `parseDocumentText`, so its
 * errors (with their lines and columns) are the ones `mlym validate` and the
 * `<ml-map>` error card show for the same file. It ensures the configuration
 * is valid before returning it.
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
  trackFile(path);
  try {
    // Read file contents
    const contents = await readFile(path, "utf-8");

    // Parse in the file's format and validate, as every surface does
    const result = await parseDocumentText(contents, { kind: "map", signals: { fileName: path } });

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
      }${missingFileHint(error)}`,
      path,
      [],
      { cause: error },
    );
  }
}

/**
 * Load and validate a scrollytelling configuration from a YAML, JSON or TOML file.
 *
 * @param path - Path to the file containing the scrollytelling configuration;
 *   its extension (`.yaml`/`.yml`, `.json`, `.toml`) picks the format
 * @returns Validated ScrollytellingBlock configuration
 * @throws {YAMLLoadError} If file cannot be read or validation fails
 *
 * @remarks
 * This function loads a story document and validates it against the
 * ScrollytellingBlockSchema from @maplibre-yaml/core, through core's
 * `parseDocumentText`, like {@link loadMapConfig}. It ensures all
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
  trackFile(path);
  try {
    // Read file contents
    const contents = await readFile(path, "utf-8");

    // Parse in the file's format and validate, as every surface does
    const result = await parseDocumentText(contents, { kind: "story", signals: { fileName: path } });

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
      }${missingFileHint(error)}`,
      path,
      [],
      { cause: error },
    );
  }
}

/**
 * Load multiple YAML, JSON or TOML configurations using Astro's glob import.
 *
 * @param globResult - Result from import.meta.glob with { as: 'raw' }
 * @param validator - Optional validation function (e.g., YAMLParser.safeParseMapBlock).
 *   It receives the file's text and, as a second argument, its path and
 *   format, and may return a promise.
 * @returns Array of loaded configurations with their paths
 * @throws {YAMLLoadError} If any file fails to load or validate
 *
 * @remarks
 * This function works with Astro's `import.meta.glob` to load multiple
 * files at once during the build process. It's useful for loading
 * collections of map configs or stories. Each file's format comes from its
 * glob key's extension (`.yaml`/`.yml`, `.json`, `.toml`), so one glob can
 * mix all three. `YAMLParser`'s methods read YAML (and JSON) text only; to
 * validate TOML files too, validate with `parseDocumentText`, as in the
 * mixed-format example below.
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
 * @example Load maps in any of the three formats
 * ```astro
 * ---
 * import { loadFromGlob } from '@maplibre-yaml/astro/utils';
 * import { parseDocumentText } from '@maplibre-yaml/core';
 *
 * const configs = await loadFromGlob(
 *   import.meta.glob('./src/configs/*.{yaml,json,toml}', { as: 'raw' }),
 *   (text, { path }) => parseDocumentText(text, { kind: 'map', signals: { fileName: path } })
 * );
 * ---
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
/** What a {@link loadFromGlob} validator returns (a core parse result fits). */
export type GlobValidation<T> = { success: boolean; data?: T; errors?: ParseError[] };

export async function loadFromGlob<T = unknown>(
  globResult: Record<string, () => Promise<string> | string>,
  validator?: (
    yaml: string,
    file: { path: string; format: DocumentFormat }
  ) => GlobValidation<T> | Promise<GlobValidation<T>>
): Promise<Array<{ path: string; config: T }>> {
  const results: Array<{ path: string; config: T }> = [];
  const errors: Array<{ path: string; errors: ParseError[] }> = [];

  for (const [path, loader] of Object.entries(globResult)) {
    try {
      // Get the raw content
      const contents = typeof loader === "function" ? await loader() : loader;

      // Parse in the format the key's extension names (a syntax error
      // throws a YAMLLoadError)
      const { value: parsed, format } = await readValue(contents, path);

      // Validate if validator provided
      if (validator) {
        const result = await validator(contents, { path, format });
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
        // Back to core's own messages: the aggregate below adds the file.
        const issues = (error.errors ?? []).map(({ reason, text: _text, loc: _loc, location: _location, ...issue }) => ({
          ...issue,
          message: reason ?? issue.message,
        }));
        errors.push({ path: error.filePath, errors: issues });
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
