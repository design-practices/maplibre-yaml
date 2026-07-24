/**
 * @file YAML parser for MapLibre configuration files
 * @module @maplibre-yaml/core/parser
 *
 * @description
 * This module provides YAML parsing, schema validation, and reference resolution
 * for MapLibre YAML configuration files. It converts YAML strings into validated
 * TypeScript objects ready for rendering.
 *
 * ## Features
 *
 * - **YAML Parsing**: Converts YAML strings to JavaScript objects
 * - **Schema Validation**: Validates against Zod schemas with detailed error messages
 * - **Reference Resolution**: Resolves `$ref` pointers to global layers and sources
 * - **Error Formatting**: Transforms Zod errors into user-friendly messages with paths
 *
 * @example
 * Basic parsing
 * ```typescript
 * import { YAMLParser } from '@maplibre-yaml/core/parser';
 *
 * const yaml = `
 * pages:
 *   - path: "/"
 *     title: "My Map"
 *     blocks:
 *       - type: map
 *         id: main
 *         config:
 *           center: [0, 0]
 *           zoom: 2
 *           mapStyle: "https://example.com/style.json"
 * `;
 *
 * const config = YAMLParser.parse(yaml);
 * ```
 *
 * @example
 * Safe parsing with error handling
 * ```typescript
 * const result = YAMLParser.safeParse(yaml);
 * if (result.success) {
 *   console.log('Valid config:', result.data);
 * } else {
 *   result.errors.forEach(err => {
 *     console.error(`${err.path}: ${err.message}`);
 *   });
 * }
 * ```
 *
 * @example
 * Reference resolution
 * ```typescript
 * const yaml = `
 * layers:
 *   myLayer:
 *     id: shared
 *     type: circle
 *     source: { type: geojson, data: {...} }
 *
 * pages:
 *   - path: "/"
 *     blocks:
 *       - type: map
 *         layers:
 *           - $ref: "#/layers/myLayer"
 * `;
 *
 * const config = YAMLParser.parse(yaml);
 * // References are automatically resolved
 * ```
 */

import { parse as parseYAML, parseDocument, LineCounter, type Document } from "yaml";
import { ZodError, type ZodIssue } from "zod";
import { RootSchema } from "../schemas/page.schema";
import { MapBlockSchema } from "../schemas/map.schema";
import { ScrollytellingBlockSchema } from "../schemas/scrollytelling.schema";
import type { z } from "zod";
import {
  collectWarnings,
  positionForPath,
  suggest,
  unknownTypeMessage,
  typeKindForOptions,
  valueAtPath,
  LAYER_TYPES,
  SOURCE_TYPES,
  BLOCK_TYPES,
  type ValidationWarning,
} from "./validation-utils";

export type { ValidationWarning } from "./validation-utils";

/**
 * Type alias for the root configuration object
 *
 * @remarks
 * Inferred from the RootSchema Zod schema
 */
export type RootConfig = z.infer<typeof RootSchema>;

/**
 * Type alias for a single map block
 *
 * @remarks
 * Inferred from the MapBlockSchema Zod schema
 */
export type MapBlock = z.infer<typeof MapBlockSchema>;

/**
 * Type alias for a scrollytelling block
 *
 * @remarks
 * Inferred from the ScrollytellingBlockSchema Zod schema
 */
export type ScrollytellingBlock = z.infer<typeof ScrollytellingBlockSchema>;

/**
 * Error information for a single validation or parsing error
 *
 * @property path - JSON path to the error location (e.g., "pages[0].blocks[1].config.center")
 * @property message - Human-readable error description
 * @property line - Optional line number in the YAML file where error occurred
 * @property column - Optional column number in the YAML file where error occurred
 * @property suggestion - Optional nearest valid alternative (did-you-mean)
 */
export interface ParseError {
  path: string;
  message: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

/**
 * Result object returned by safeParse operations
 *
 * @property success - Whether parsing and validation succeeded
 * @property data - Validated configuration object (only present if success is true)
 * @property errors - Array of errors (only present if success is false)
 * @property warnings - Non-fatal findings (unknown keys, deprecations, bounded
 *   expression checks). Present on both success and failure; always an array.
 */
export interface ParseResult<T = RootConfig> {
  success: boolean;
  data?: T;
  errors: ParseError[];
  warnings: ValidationWarning[];
}

/**
 * Discriminated result returned by {@link YAMLParser.safeParseAny}
 *
 * @remarks
 * The `blockType` field identifies which schema the document was validated
 * against, and `result` carries the corresponding safeParse result:
 *
 * - `'map'` — document had `type: map`, validated with {@link YAMLParser.safeParseMapBlock}
 * - `'scrollytelling'` — document had `type: scrollytelling`, validated with {@link YAMLParser.safeParseScrollytellingBlock}
 * - `'root'` — document had no `type:` but a `pages:` array, validated with {@link YAMLParser.safeParse}
 * - `'unknown'` — the document type could not be determined (unrecognized
 *   `type:` value, YAML syntax error, or a document that is neither a block
 *   nor a root config); `result` is always a failure with a descriptive error
 */
export type SafeParseAnyResult =
  | { blockType: "map"; result: ParseResult<MapBlock> }
  | { blockType: "scrollytelling"; result: ParseResult<ScrollytellingBlock> }
  | { blockType: "root"; result: ParseResult<RootConfig> }
  | { blockType: "unknown"; result: ParseResult<never> };

/**
 * YAML parser with schema validation and reference resolution
 *
 * @remarks
 * This class provides static methods for parsing YAML configuration files,
 * validating them against schemas, and resolving references between configuration
 * sections. All methods are static as the parser maintains no internal state.
 *
 * @example
 * Parse and validate YAML (throws on error)
 * ```typescript
 * const config = YAMLParser.parse(yamlString);
 * ```
 *
 * @example
 * Safe parse (returns result object)
 * ```typescript
 * const result = YAMLParser.safeParse(yamlString);
 * if (!result.success) {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */
export class YAMLParser {
  /**
   * Parse YAML string and validate against schema
   *
   * @param yaml - YAML string to parse
   * @returns Validated configuration object
   * @throws {Error} If YAML syntax is invalid
   * @throws {ZodError} If validation fails
   *
   * @remarks
   * This method parses the YAML, validates it against the RootSchema,
   * resolves all references, and returns the validated config. If any
   * step fails, it throws an error.
   *
   * @example
   * ```typescript
   * try {
   *   const config = YAMLParser.parse(yamlString);
   *   console.log('Valid config:', config);
   * } catch (error) {
   *   console.error('Parse error:', error.message);
   * }
   * ```
   */
  static parse(yaml: string): RootConfig {
    // Parse YAML string to JavaScript object
    let parsed: unknown;
    try {
      parsed = parseYAML(yaml);
    } catch (error) {
      throw new Error(
        `YAML syntax error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Validate against schema
    const validated = RootSchema.parse(parsed);

    // Resolve references
    return this.resolveReferences(validated);
  }

  /**
   * Parse YAML string and validate, returning a result object
   *
   * @param yaml - YAML string to parse
   * @returns Result object with success flag and either data or errors
   *
   * @remarks
   * This is the non-throwing version of {@link parse}. Instead of throwing
   * errors, it returns a result object that indicates success or failure.
   * Use this when you want to handle errors gracefully without try/catch.
   *
   * @example
   * ```typescript
   * const result = YAMLParser.safeParse(yamlString);
   * if (result.success) {
   *   console.log('Config:', result.data);
   * } else {
   *   result.errors.forEach(err => {
   *     console.error(`Error at ${err.path}: ${err.message}`);
   *   });
   * }
   * ```
   */
  static safeParse(yaml: string): ParseResult {
    return this.safeParseWithSchema(yaml, RootSchema, true) as ParseResult;
  }

  /**
   * Parse a YAML document while preserving source positions.
   *
   * @internal
   * @remarks
   * Uses the `yaml` document API with a {@link LineCounter} so that YAML syntax
   * errors carry `{ line, column }` and Zod issue paths can be mapped back to
   * source positions via node ranges.
   */
  private static parseToDocument(yaml: string): {
    doc: Document;
    lineCounter: LineCounter;
    syntaxError?: ParseError;
  } {
    const lineCounter = new LineCounter();
    const doc = parseDocument(yaml, { lineCounter });

    if (doc.errors.length > 0) {
      const err = doc.errors[0]!;
      const start = err.linePos?.[0];
      return {
        doc,
        lineCounter,
        syntaxError: {
          path: "",
          message: `YAML syntax error: ${err.message}`,
          ...(start ? { line: start.line, column: start.col } : {}),
        },
      };
    }

    return { doc, lineCounter };
  }

  /**
   * Shared safe-parse implementation with position mapping and warnings.
   *
   * @internal
   */
  private static safeParseWithSchema<T>(
    yaml: string,
    schema: z.ZodType<T>,
    resolveRefs: boolean
  ): ParseResult<T> {
    const { doc, lineCounter, syntaxError } = this.parseToDocument(yaml);
    if (syntaxError) {
      return { success: false, errors: [syntaxError], warnings: [] };
    }

    const value = doc.toJS() as unknown;

    // Warnings are collected from the raw value regardless of validity so
    // typos and deprecations still surface when other hard errors are present.
    const warnings = collectWarnings(
      value,
      schema as unknown as z.ZodTypeAny,
      doc,
      lineCounter
    );

    const result = schema.safeParse(value);
    if (!result.success) {
      return {
        success: false,
        errors: this.formatZodErrors(result.error, { doc, lineCounter, value }),
        warnings,
      };
    }

    if (resolveRefs) {
      try {
        const resolved = this.resolveReferences(
          result.data as unknown as RootConfig
        );
        return {
          success: true,
          data: resolved as unknown as T,
          warnings,
          errors: [],
        };
      } catch (error) {
        return {
          success: false,
          errors: [
            {
              path: "",
              message: error instanceof Error ? error.message : String(error),
            },
          ],
          warnings,
        };
      }
    }

    return { success: true, data: result.data, warnings, errors: [] };
  }

  /**
   * Validate a JavaScript object against the schema
   *
   * @param config - JavaScript object to validate
   * @returns Validated configuration object
   * @throws {ZodError} If validation fails
   *
   * @remarks
   * This method bypasses YAML parsing and directly validates a JavaScript object.
   * Useful when you already have a parsed object (e.g., from JSON.parse) and just
   * want to validate and resolve references.
   *
   * @example
   * ```typescript
   * const jsConfig = JSON.parse(jsonString);
   * const validated = YAMLParser.validate(jsConfig);
   * ```
   */
  static validate(config: unknown): RootConfig {
    const validated = RootSchema.parse(config);
    return this.resolveReferences(validated);
  }

  /**
   * Parse YAML string for a single map block and validate against MapBlockSchema
   *
   * @param yaml - YAML string to parse (should be a map block, not a full document)
   * @returns Validated map block object
   * @throws {Error} If YAML syntax is invalid
   * @throws {ZodError} If validation fails
   *
   * @remarks
   * This method is specifically for parsing individual map blocks (e.g., in documentation
   * or component usage). Unlike {@link parse}, it validates against MapBlockSchema rather
   * than RootSchema, so it expects a single map configuration without the pages array wrapper.
   *
   * @example
   * ```typescript
   * const yaml = `
   * type: map
   * id: example
   * config:
   *   center: [0, 0]
   *   zoom: 2
   *   mapStyle: "https://example.com/style.json"
   * layers:
   *   - id: points
   *     type: circle
   *     source:
   *       type: geojson
   *       data: { type: "FeatureCollection", features: [] }
   * `;
   *
   * const mapBlock = YAMLParser.parseMapBlock(yaml);
   * ```
   */
  static parseMapBlock(yaml: string): MapBlock {
    // Parse YAML string to JavaScript object
    let parsed: unknown;
    try {
      parsed = parseYAML(yaml);
    } catch (error) {
      throw new Error(
        `YAML syntax error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Validate against MapBlockSchema
    return MapBlockSchema.parse(parsed);
  }

  /**
   * Parse YAML string for a single map block, returning a result object
   *
   * @param yaml - YAML string to parse (should be a map block, not a full document)
   * @returns Result object with success flag and either data or errors
   *
   * @remarks
   * This is the non-throwing version of {@link parseMapBlock}. Instead of throwing
   * errors, it returns a result object that indicates success or failure.
   * Use this when you want to handle errors gracefully without try/catch.
   *
   * @example
   * ```typescript
   * const result = YAMLParser.safeParseMapBlock(yamlString);
   * if (result.success) {
   *   console.log('Map config:', result.data);
   * } else {
   *   result.errors.forEach(err => {
   *     console.error(`Error at ${err.path}: ${err.message}`);
   *   });
   * }
   * ```
   */
  static safeParseMapBlock(yaml: string): ParseResult<MapBlock> {
    return this.safeParseWithSchema(yaml, MapBlockSchema, false);
  }

  /**
   * Parse YAML string for a scrollytelling block and validate against ScrollytellingBlockSchema
   *
   * @param yaml - YAML string to parse (should be a scrollytelling block, not a full document)
   * @returns Validated scrollytelling block object
   * @throws {Error} If YAML syntax is invalid
   * @throws {ZodError} If validation fails
   *
   * @remarks
   * This method is specifically for parsing individual scrollytelling blocks (e.g., in documentation
   * or component usage). Unlike {@link parse}, it validates against ScrollytellingBlockSchema rather
   * than RootSchema, so it expects a single scrollytelling configuration without the pages array wrapper.
   *
   * @example
   * ```typescript
   * const yaml = `
   * type: scrollytelling
   * id: story
   * config:
   *   center: [0, 0]
   *   zoom: 2
   *   mapStyle: "https://example.com/style.json"
   * chapters:
   *   - id: intro
   *     title: "Introduction"
   *     center: [0, 0]
   *     zoom: 3
   *     description: "Welcome to our story."
   *   - id: chapter2
   *     title: "Chapter 2"
   *     center: [10, 10]
   *     zoom: 5
   *     description: "The story continues."
   * `;
   *
   * const scrollyBlock = YAMLParser.parseScrollytellingBlock(yaml);
   * ```
   */
  static parseScrollytellingBlock(yaml: string): ScrollytellingBlock {
    // Parse YAML string to JavaScript object
    let parsed: unknown;
    try {
      parsed = parseYAML(yaml);
    } catch (error) {
      throw new Error(
        `YAML syntax error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Validate against ScrollytellingBlockSchema
    return ScrollytellingBlockSchema.parse(parsed);
  }

  /**
   * Parse YAML string for a scrollytelling block, returning a result object
   *
   * @param yaml - YAML string to parse (should be a scrollytelling block, not a full document)
   * @returns Result object with success flag and either data or errors
   *
   * @remarks
   * This is the non-throwing version of {@link parseScrollytellingBlock}. Instead of throwing
   * errors, it returns a result object that indicates success or failure.
   * Use this when you want to handle errors gracefully without try/catch.
   *
   * @example
   * ```typescript
   * const result = YAMLParser.safeParseScrollytellingBlock(yamlString);
   * if (result.success) {
   *   console.log('Scrollytelling config:', result.data);
   * } else {
   *   result.errors.forEach(err => {
   *     console.error(`Error at ${err.path}: ${err.message}`);
   *   });
   * }
   * ```
   */
  static safeParseScrollytellingBlock(
    yaml: string
  ): ParseResult<ScrollytellingBlock> {
    return this.safeParseWithSchema(
      yaml,
      ScrollytellingBlockSchema,
      false
    );
  }

  /**
   * Detect the document type of a YAML string and validate it against the
   * matching schema
   *
   * @param yaml - YAML string to parse (a map block, a scrollytelling block, or a root document)
   * @returns Discriminated result with the detected block type and the corresponding safeParse result
   *
   * @remarks
   * Dispatches on the document's top-level `type:` field:
   *
   * - `type: map` → {@link safeParseMapBlock}
   * - `type: scrollytelling` → {@link safeParseScrollytellingBlock}
   * - no `type:` but a `pages:` key → {@link safeParse} (root document)
   *
   * Any other `type:` value produces a failure result listing the valid
   * values, as does a document that has neither `type:` nor `pages:`.
   * This method never throws.
   *
   * @example
   * ```typescript
   * const { blockType, result } = YAMLParser.safeParseAny(yamlString);
   * if (!result.success) {
   *   result.errors.forEach(err => console.error(`${err.path}: ${err.message}`));
   * } else if (blockType === 'map') {
   *   renderMap(result.data);
   * }
   * ```
   */
  static safeParseAny(yaml: string): SafeParseAnyResult {
    // Parse once (with a LineCounter) to inspect the top-level `type:`
    // discriminator and surface positioned syntax errors.
    const { doc: yamlDoc, syntaxError } = this.parseToDocument(yaml);
    if (syntaxError) {
      return {
        blockType: "unknown",
        result: { success: false, errors: [syntaxError], warnings: [] },
      };
    }

    const parsed = yamlDoc.toJS() as unknown;
    const doc =
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    const type = doc?.type;

    if (type === "map") {
      return { blockType: "map", result: this.safeParseMapBlock(yaml) };
    }

    if (type === "scrollytelling") {
      return {
        blockType: "scrollytelling",
        result: this.safeParseScrollytellingBlock(yaml),
      };
    }

    // Treat a present-but-null `type:` (e.g. `type:` with no value) the same as
    // a missing one, so it falls through to `pages`-based root detection rather
    // than being reported as `Unknown block type: null`.
    if (type != null) {
      const hint =
        typeof type === "string" ? suggest(type, BLOCK_TYPES) : undefined;
      return {
        blockType: "unknown",
        result: {
          success: false,
          errors: [
            {
              path: "type",
              message:
                `Unknown block type: ${JSON.stringify(type)}. ` +
                `Expected one of: ${BLOCK_TYPES.join(", ")}. ` +
                `Root documents omit "type" and use a top-level "pages:" array instead.` +
                (hint ? ` Did you mean "${hint}"?` : ""),
              ...(hint ? { suggestion: hint } : {}),
            },
          ],
          warnings: [],
        },
      };
    }

    if (doc !== null && "pages" in doc) {
      return { blockType: "root", result: this.safeParse(yaml) };
    }

    return {
      blockType: "unknown",
      result: {
        success: false,
        errors: [
          {
            path: "",
            message:
              'Unable to determine document type. Expected a block with "type: map" or "type: scrollytelling", or a root document with a top-level "pages:" array.',
          },
        ],
        warnings: [],
      },
    };
  }

  /**
   * Resolve $ref references to global layers and sources
   *
   * @param config - Configuration object with potential references
   * @returns Configuration with all references resolved
   * @throws {Error} If a reference cannot be resolved
   *
   * @remarks
   * References use JSON Pointer-like syntax: `#/layers/layerName` or `#/sources/sourceName`.
   * This method walks the configuration tree, finds all objects with a `$ref` property,
   * looks up the referenced item in `config.layers` or `config.sources`, and replaces
   * the reference object with the actual item.
   *
   * ## Reference Syntax
   *
   * - `#/layers/myLayer` - Reference to a layer in the global `layers` section
   * - `#/sources/mySource` - Reference to a source in the global `sources` section
   *
   * @example
   * ```typescript
   * const config = {
   *   layers: {
   *     myLayer: { id: 'layer1', type: 'circle', ... }
   *   },
   *   pages: [{
   *     blocks: [{
   *       type: 'map',
   *       layers: [{ $ref: '#/layers/myLayer' }]
   *     }]
   *   }]
   * };
   *
   * const resolved = YAMLParser.resolveReferences(config);
   * // resolved.pages[0].blocks[0].layers[0] now contains the full layer object
   * ```
   */
  static resolveReferences(config: RootConfig): RootConfig {
    /**
     * Recursively walk an object and resolve references
     */
    const resolveInObject = (obj: any): any => {
      // Handle null/undefined
      if (obj == null) return obj;

      // Handle arrays
      if (Array.isArray(obj)) {
        return obj.map((item) => resolveInObject(item));
      }

      // Handle objects
      if (typeof obj === "object") {
        // Check if this is a reference object
        if ("$ref" in obj && typeof obj.$ref === "string") {
          const ref = obj.$ref;

          // Parse reference: #/layers/layerName or #/sources/sourceName
          const match = ref.match(/^#\/(layers|sources)\/(.+)$/);
          if (!match) {
            throw new Error(
              `Invalid reference format: ${ref}. Expected #/layers/name or #/sources/name`
            );
          }

          const [, section, name] = match;

          // Look up the referenced item
          if (section === "layers") {
            if (!config.layers || !(name in config.layers)) {
              const defined = Object.keys(config.layers ?? {});
              const hint = suggest(name, defined);
              throw new Error(
                `Layer reference not found: ${ref}.` +
                  (hint ? ` Did you mean "#/layers/${hint}"?` : "") +
                  (defined.length
                    ? ` Defined layers: ${defined.join(", ")}.`
                    : " No layers are defined at the root level.")
              );
            }
            return config.layers[name];
          } else if (section === "sources") {
            if (!config.sources || !(name in config.sources)) {
              const defined = Object.keys(config.sources ?? {});
              const hint = suggest(name, defined);
              throw new Error(
                `Source reference not found: ${ref}.` +
                  (hint ? ` Did you mean "#/sources/${hint}"?` : "") +
                  (defined.length
                    ? ` Defined sources: ${defined.join(", ")}.`
                    : " No sources are defined at the root level.")
              );
            }
            return config.sources[name];
          }
        }

        // Recursively process all properties
        const resolved: any = {};
        for (const [key, value] of Object.entries(obj)) {
          resolved[key] = resolveInObject(value);
        }
        return resolved;
      }

      // Primitives
      return obj;
    };

    return resolveInObject(config);
  }

  /**
   * Format Zod validation errors into user-friendly messages
   *
   * @param error - Zod validation error
   * @returns Array of formatted error objects
   *
   * @remarks
   * This method transforms Zod's internal error format into human-readable
   * messages with clear paths and descriptions. It handles various Zod error
   * types and provides appropriate messages for each.
   *
   * ## Error Type Handling
   *
   * - `invalid_type`: Type mismatch (e.g., expected number, got string)
   * - `invalid_union_discriminator`: Invalid discriminator for union types
   * - `invalid_union`: None of the union options matched
   * - `too_small`: Value below minimum (arrays, strings, numbers)
   * - `too_big`: Value above maximum
   * - `invalid_string`: String format validation failed
   * - `custom`: Custom validation refinement failed
   *
   * @example
   * ```typescript
   * try {
   *   RootSchema.parse(invalidConfig);
   * } catch (error) {
   *   if (error instanceof ZodError) {
   *     const formatted = YAMLParser.formatZodErrors(error);
   *     formatted.forEach(err => {
   *       console.error(`${err.path}: ${err.message}`);
   *     });
   *   }
   * }
   * ```
   */
  private static formatZodErrors(
    error: ZodError,
    ctx?: { doc: Document; lineCounter: LineCounter; value: unknown }
  ): ParseError[] {
    return error.errors.map((err) => {
      const path = err.path.join(".");

      let message: string;
      switch (err.code) {
        case "invalid_type":
          message = `Expected ${err.expected}, got ${err.received}`;
          break;

        case "invalid_union_discriminator": {
          const received = ctx
            ? valueAtPath(ctx.value, err.path)
            : undefined;
          message = this.unknownTypeOrFallback(
            err.options as unknown[],
            received,
            `Invalid type. Expected one of: ${(err.options as unknown[]).join(
              ", "
            )}`
          );
          break;
        }

        case "invalid_union":
          message = this.formatUnionError(err, ctx);
          break;

        case "too_small":
          if (err.type === "array") {
            message = `Array must have at least ${err.minimum} element(s)`;
          } else if (err.type === "string") {
            message = `String must have at least ${err.minimum} character(s)`;
          } else {
            message = `Value must be >= ${err.minimum}`;
          }
          break;

        case "too_big":
          if (err.type === "array") {
            message = `Array must have at most ${err.maximum} element(s)`;
          } else if (err.type === "string") {
            message = `String must have at most ${err.maximum} character(s)`;
          } else {
            message = `Value must be <= ${err.maximum}`;
          }
          break;

        case "invalid_string":
          if (err.validation === "url") {
            message = "Invalid URL format";
          } else if (err.validation === "email") {
            message = "Invalid email format";
          } else {
            message = `Invalid string format: ${err.validation}`;
          }
          break;

        case "custom":
          message = err.message || "Validation failed";
          break;

        default:
          message = err.message || "Validation error";
      }

      const pos = ctx
        ? positionForPath(ctx.doc, ctx.lineCounter, err.path)
        : undefined;

      return {
        path,
        message,
        ...(pos ? { line: pos.line, column: pos.column } : {}),
      };
    });
  }

  /**
   * Build a friendly "unknown layer/source type" message when a discriminator
   * option list matches the layer or source vocabulary; otherwise return the
   * supplied fallback.
   *
   * @internal
   */
  private static unknownTypeOrFallback(
    options: unknown[],
    received: unknown,
    fallback: string
  ): string {
    const kind = typeKindForOptions(options);
    if (kind === "layer") {
      return unknownTypeMessage("layer", received, LAYER_TYPES);
    }
    if (kind === "source") {
      return unknownTypeMessage("source", received, SOURCE_TYPES);
    }
    return fallback;
  }

  /**
   * Format a Zod `invalid_union` issue, surfacing a nested discriminator failure
   * (e.g. a layer or source object with a bad `type`) as a friendly
   * unknown-type message with did-you-mean.
   *
   * @internal
   */
  private static formatUnionError(
    err: ZodIssue & { code: "invalid_union" },
    ctx?: { doc: Document; lineCounter: LineCounter; value: unknown }
  ): string {
    const fallback = "Value does not match any of the expected formats";
    const value = ctx?.value;

    // 1) A discriminated union failing on its discriminator (a layer with an
    //    unknown `type`, wrapped in the layer-or-reference union). Nested Zod
    //    union issue paths are absolute, so use them as-is.
    const disc = findDiscriminatorIssue(err.unionErrors);
    if (disc) {
      const received = valueAtPath(value, disc.path);
      const message = this.unknownTypeOrFallback(
        disc.options as unknown[],
        received,
        fallback
      );
      if (message !== fallback) return message;
    }

    // 2) A source object with a bad `type`. The source union is a plain union,
    //    so its members fail with `invalid_literal` on `type` rather than a
    //    discriminator issue. This can surface at the source path directly
    //    (root/block `sources:`) or nested inside a layer error (inline
    //    `source:`) — search the whole union-error tree for it.
    const sourceTypePath =
      findSourceTypeIssuePath(err.unionErrors) ??
      // ...or the union node itself is the source (e.g. `sources: { s: {...} }`).
      (looksLikeSourcePath(err.path) &&
      isObjectWithType(valueAtPath(value, err.path))
        ? [...err.path, "type"]
        : undefined);

    if (sourceTypePath) {
      const received = valueAtPath(value, sourceTypePath);
      // Only a *genuinely unknown* type gets the "Unknown source type" message.
      // A source with a VALID type that fails for another reason (e.g. a
      // geojson source missing url/data, or an image source missing
      // coordinates) makes every *sibling* branch emit an `invalid_literal`
      // on `type` — mining those would wrongly report the valid type as
      // unknown AND hide the real failure. Surface the real error instead.
      if (
        typeof received !== "string" ||
        !(SOURCE_TYPES as readonly string[]).includes(received)
      ) {
        return unknownTypeMessage("source", received, SOURCE_TYPES);
      }
      const match = findMatchingSourceBranch(err.unionErrors);
      if (match) {
        const real = this.formatZodErrors(match)[0];
        if (real) return real.message;
      }
    }

    return fallback;
  }
}

/** Whether a JSON path anchors on a source (`.source` or a `sources` record). */
function looksLikeSourcePath(path: (string | number)[]): boolean {
  return path.includes("source") || path.includes("sources");
}

function isObjectWithType(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "type" in (value as Record<string, unknown>)
  );
}

/**
 * Recursively search a set of Zod union member errors for the first
 * `invalid_union_discriminator` issue.
 *
 * @internal
 */
function findDiscriminatorIssue(
  unionErrors: ZodError[]
):
  | (ZodIssue & { code: "invalid_union_discriminator"; options: unknown[] })
  | undefined {
  for (const unionError of unionErrors) {
    for (const issue of unionError.issues) {
      if (issue.code === "invalid_union_discriminator") {
        return issue as ZodIssue & {
          code: "invalid_union_discriminator";
          options: unknown[];
        };
      }
      if (issue.code === "invalid_union") {
        const nested = findDiscriminatorIssue(issue.unionErrors);
        if (nested) return nested;
      }
    }
  }
  return undefined;
}

/**
 * Recursively search a union-error tree for an `invalid_literal` issue on a
 * `type` key that sits under a source path, returning the absolute path to that
 * `type` node. Used to surface inline layer `source:` type typos, whose error
 * bubbles up at the layer level rather than the source level.
 *
 * @internal
 */
function findSourceTypeIssuePath(
  unionErrors: ZodError[]
): (string | number)[] | undefined {
  for (const unionError of unionErrors) {
    for (const issue of unionError.issues) {
      if (isSourceTypeLiteralIssue(issue)) {
        return issue.path;
      }
      if (issue.code === "invalid_union") {
        const nested = findSourceTypeIssuePath(issue.unionErrors);
        if (nested) return nested;
      }
    }
  }
  return undefined;
}

/** Whether an issue is an `invalid_literal` on a source's `type` discriminator. */
function isSourceTypeLiteralIssue(issue: ZodIssue): boolean {
  return (
    issue.code === "invalid_literal" &&
    issue.path.length > 0 &&
    issue.path[issue.path.length - 1] === "type" &&
    looksLikeSourcePath(issue.path.slice(0, -1))
  );
}

/**
 * Locate the source-union member whose `type` discriminator matched — i.e. the
 * branch that failed for a *real* reason (missing url/data/coordinates, ...)
 * rather than a `type` mismatch — so its genuine error can be surfaced instead
 * of a self-contradictory "Unknown source type <valid type>". Recurses through
 * nested unions to find the source union first.
 *
 * @internal
 */
function findMatchingSourceBranch(
  unionErrors: ZodError[]
): ZodError | undefined {
  // If this union level is the source union, at least one branch fails on
  // `type`; the matching branch is the one that does not.
  if (unionErrors.some((ue) => ue.issues.some(isSourceTypeLiteralIssue))) {
    const match = unionErrors.find(
      (ue) =>
        ue.issues.length > 0 && !ue.issues.some(isSourceTypeLiteralIssue)
    );
    if (match) return match;
  }
  for (const unionError of unionErrors) {
    for (const issue of unionError.issues) {
      if (issue.code === "invalid_union") {
        const nested = findMatchingSourceBranch(issue.unionErrors);
        if (nested) return nested;
      }
    }
  }
  return undefined;
}

/**
/**
 * Convenience function to parse YAML config
 *
 * @param yaml - YAML string to parse
 * @returns Validated configuration object
 * @throws {Error} If parsing or validation fails
 *
 * @remarks
 * This is an alias for {@link YAMLParser.parse} for convenient imports.
 *
 * @example
 * ```typescript
 * import { parseYAMLConfig } from '@maplibre-yaml/core/parser';
 * const config = parseYAMLConfig(yamlString);
 * ```
 */
export const parseYAMLConfig = YAMLParser.parse.bind(YAMLParser);

/**
 * Convenience function to safely parse YAML config
 *
 * @param yaml - YAML string to parse
 * @returns Result object with success flag and data or errors
 *
 * @remarks
 * This is an alias for {@link YAMLParser.safeParse} for convenient imports.
 *
 * @example
 * ```typescript
 * import { safeParseYAMLConfig } from '@maplibre-yaml/core/parser';
 * const result = safeParseYAMLConfig(yamlString);
 * if (result.success) {
 *   console.log(result.data);
 * }
 * ```
 */
export const safeParseYAMLConfig = YAMLParser.safeParse.bind(YAMLParser);

/**
 * Convenience function to detect and validate any supported document type
 *
 * @param yaml - YAML string to parse (map block, scrollytelling block, or root document)
 * @returns Discriminated result with the detected block type and safeParse result
 *
 * @remarks
 * This is an alias for {@link YAMLParser.safeParseAny} for convenient imports.
 *
 * @example
 * ```typescript
 * import { safeParseAny } from '@maplibre-yaml/core/parser';
 * const { blockType, result } = safeParseAny(yamlString);
 * ```
 */
export const safeParseAny = YAMLParser.safeParseAny.bind(YAMLParser);
