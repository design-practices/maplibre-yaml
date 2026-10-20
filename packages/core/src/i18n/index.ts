/**
 * @file Languages: the UI string table and locale-aware number formatting
 * @module @maplibre-yaml/core/i18n
 */

export {
  STRINGS_PREFIX,
  DEFAULT_STRINGS,
  MAPLIBRE_STRINGS,
  createStrings,
  defaultStrings,
  fillPlaceholders,
  documentLocale,
  elementLanguage,
} from "./strings";
export type { StringKey, MapLibreStringKey, StringParams, Strings } from "./strings";
export {
  formatNumber,
  toIntlNumberFormatOptions,
  legacyNumberFormat,
} from "./number-format";
export type { NumberFormatOptions, NumberFormat } from "./number-format";
