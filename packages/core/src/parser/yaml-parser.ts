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

import { parse as parseYAML } from "yaml";
import { ZodError } from "zod";
import { RootSchema } from "../schemas/page.schema";
import { MapBlockSchema } from "../schemas/map.schema";
import type { z } from "zod";

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
 * Error information for a single validation or parsing error
 *
 * @property path - JSON path to the error location (e.g., "pages[0].blocks[1].config.center")
 * @property message - Human-readable error description
 * @property line - Optional line number in the YAML file where error occurred
 * @property column - Optional column number in the YAML file where error occurred
 */
export interface ParseError {
  path: string;
  message: string;
  line?: number;
  column?: number;
}

/**
 * Result object returned by safeParse operations
 *
 * @property success - Whether parsing and validation succeeded
 * @property data - Validated configuration object (only present if success is true)
 * @property errors - Array of errors (only present if success is false)
 */
export interface ParseResult<T = RootConfig> {
  success: boolean;
  data?: T;
  errors: ParseError[];
}

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
    try {
      const data = this.parse(yaml);
      return {
        success: true,
        data,
        errors: [],
      };
    } catch (error) {
      // Handle Zod validation errors
      if (error instanceof ZodError) {
        return {
          success: false,
          errors: this.formatZodErrors(error),
        };
      }

      // Handle other errors (YAML syntax, reference errors, etc.)
      return {
        success: false,
        errors: [
          {
            path: "",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
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
    try {
      const data = this.parseMapBlock(yaml);
      return {
        success: true,
        data,
        errors: [],
      };
    } catch (error) {
      // Handle Zod validation errors
      if (error instanceof ZodError) {
        return {
          success: false,
          errors: this.formatZodErrors(error),
        };
      }

      // Handle other errors (YAML syntax, etc.)
      return {
        success: false,
        errors: [
          {
            path: "",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
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
              throw new Error(`Layer reference not found: ${ref}`);
            }
            return config.layers[name];
          } else if (section === "sources") {
            if (!config.sources || !(name in config.sources)) {
              throw new Error(`Source reference not found: ${ref}`);
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
  private static formatZodErrors(error: ZodError): ParseError[] {
    return error.errors.map((err) => {
      const path = err.path.join(".");

      let message: string;
      switch (err.code) {
        case "invalid_type":
          message = `Expected ${err.expected}, got ${err.received}`;
          break;

        case "invalid_union_discriminator":
          message = `Invalid type. Expected one of: ${err.options.join(", ")}`;
          break;

        case "invalid_union":
          message = "Value does not match any of the expected formats";
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

      return {
        path,
        message,
      };
    });
  }
}

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
