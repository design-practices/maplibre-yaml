/**
 * The extension registry: validation, normalization, and safe delivery of
 * `x-*` extension blocks.
 *
 * @module extensions
 */

export { ExtensionRegistry } from "./registry";
export type {
  ExtensionDefinition,
  ExtensionBlock,
  ExtensionWarning,
  ExtractResult,
} from "./registry";
