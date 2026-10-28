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
// The canonical parse options + `!html` tag — the single source of truth a
// consumer parsing YAML itself imports rather than re-declaring (which drifts).
export { YAML_PARSE_OPTIONS, htmlTag } from './yaml-parser';
// The path to show a reader before a message (chapter problems name the
// chapter in the message instead): for error cards, CLIs, editors.
export { displayPath } from './validation-utils';
export type { ParseError, ParseErrorCode, ParseResult, SafeParseAnyResult } from './yaml-parser';
// The normalizations every document gets before validation (root `$schema`,
// nested `locale` tables, dates), for a value parsed elsewhere: an Astro
// content-collection entry, a value a host built.
export { normalizeDocumentValue } from './normalize';
export type { NormalizedValue } from './normalize';
// The front door for document text in YAML, JSON or TOML: detects the
// format and words every error for it.
export { parseDocumentText, stripBom } from './document-text';
// Whether JSON or TOML text is a map or story document, judged from the text
// (the rule `mlym validate` picks a folder's .json and .toml files by).
export { looksLikeDocumentText } from './document-marks';
export type {
  DocumentFormat,
  DocumentKind,
  DocumentSignals,
  ParseDocumentTextOptions,
  FormattedParseResult,
  DocumentTextResult,
} from './document-text';
// Note: RootConfig, MapBlock, ScrollytellingBlock types are exported from ./schemas
