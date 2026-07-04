/**
 * @file Parser module exports
 * @module @maplibre-yaml/core/parser
 *
 * @description
 * This module exports the YAML parser and related utilities for parsing and
 * validating MapLibre YAML configuration files.
 *
 * @example
 * ```typescript
 * import { YAMLParser, parseYAMLConfig } from '@maplibre-yaml/core/parser';
 *
 * const config = parseYAMLConfig(yamlString);
 * ```
 */

export { YAMLParser, parseYAMLConfig, safeParseYAMLConfig, safeParseAny } from './yaml-parser';
export type { ParseError, ParseResult, SafeParseAnyResult } from './yaml-parser';
// Note: RootConfig, MapBlock, ScrollytellingBlock types are exported from ./schemas
