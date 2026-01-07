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

export { YAMLParser, parseYAMLConfig, safeParseYAMLConfig } from './yaml-parser';
export type { RootConfig, MapBlock, ScrollytellingBlock, ParseError, ParseResult } from './yaml-parser';
