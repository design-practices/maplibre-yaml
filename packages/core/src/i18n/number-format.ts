/**
 * @file Locale-aware number formatting with MapLibre's `number-format` vocabulary
 * @module @maplibre-yaml/core/i18n
 *
 * @description
 * One formatter for every number the library writes on a page: popup values,
 * the params panel's slider readout, and generated legend labels. The options
 * are the ones MapLibre's `number-format` expression takes — `locale`,
 * `currency`, `unit`, `min-fraction-digits`, `max-fraction-digits` — so an
 * author learns one vocabulary for map labels and popups alike, and they map
 * one-to-one onto `Intl.NumberFormat`.
 *
 * The locale defaults to the page's language (the nearest `lang` attribute,
 * see {@link elementLanguage}), then the browser's.
 */

import { normalizeLocale } from "./strings";

/**
 * MapLibre `number-format` options.
 *
 * @see https://maplibre.org/maplibre-style-spec/expressions/#number-format
 */
export interface NumberFormatOptions {
  /** BCP 47 language tag, e.g. `de-DE`. Default: the page's language. */
  locale?: string;
  /** ISO 4217 currency code, e.g. `EUR`: formats as money. */
  currency?: string;
  /** A unit Intl knows, e.g. `kilometer`, `percent`, `celsius`. Ignored with `currency`. */
  unit?: string;
  /** At least this many digits after the decimal separator. */
  "min-fraction-digits"?: number;
  /** At most this many digits after the decimal separator (rounds). */
  "max-fraction-digits"?: number;
}

/** A popup `format:` as authored: the options, or an older `",.2f"` string. */
export type NumberFormat = NumberFormatOptions | string;

const cache = new Map<string, Intl.NumberFormat>();
const warned = new Set<string>();

/** A digit count Intl accepts (0–20), or undefined. */
function digits(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(20, Math.max(0, Math.round(value)));
}

/**
 * The `Intl.NumberFormat` options for MapLibre's `number-format` options.
 * Exported for tests and hosts that format with Intl directly.
 */
export function toIntlNumberFormatOptions(options: NumberFormatOptions = {}): Intl.NumberFormatOptions {
  const intl: Intl.NumberFormatOptions = {};
  // MapLibre's precedence: currency, then unit, then a plain decimal.
  if (typeof options.currency === "string" && options.currency.trim() !== "") {
    intl.style = "currency";
    intl.currency = options.currency.trim();
  } else if (typeof options.unit === "string" && options.unit.trim() !== "") {
    intl.style = "unit";
    intl.unit = options.unit.trim();
  }
  let min = digits(options["min-fraction-digits"]);
  let max = digits(options["max-fraction-digits"]);
  // Engines older than ES2023 throw when only one bound is given and it
  // contradicts the style's default for the other; set both.
  if (max !== undefined && min === undefined) min = Math.min(max, intl.style === "currency" ? 2 : 0);
  if (min !== undefined && max === undefined) max = Math.max(min, intl.style === "currency" ? 2 : 3);
  if (min !== undefined && max !== undefined && min > max) max = min;
  if (min !== undefined) intl.minimumFractionDigits = min;
  if (max !== undefined) intl.maximumFractionDigits = max;
  return intl;
}

/**
 * The older `format: ",.0f"` string (a d3-format subset: `,` groups
 * thousands, `.N` fixes N decimals), as options. Formatting then follows the
 * page's language like every other format; it used to be US English always.
 */
export function legacyNumberFormat(format: string): NumberFormatOptions & { grouping: boolean } {
  const decimals = /\.(\d+)/.exec(format)?.[1];
  const n = decimals !== undefined ? Number(decimals) : 0;
  return { grouping: format.includes(","), "min-fraction-digits": n, "max-fraction-digits": n };
}

function formatter(locale: string | undefined, intl: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale ?? ""}|${JSON.stringify(intl)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, intl);
    if (cache.size > 200) cache.clear();
    cache.set(key, f);
  }
  return f;
}

/**
 * Format a number with MapLibre `number-format` options.
 *
 * @remarks
 * Locale tags are read with {@link normalizeLocale} (`en_US` → `en-US`). A
 * locale or option `Intl` rejects never loses more than it must: the
 * options are tried under the default locale, then the browser's, then
 * grouping and fraction digits alone — the bare `String(value)` is the last
 * resort.
 *
 * @param value - the number.
 * @param format - `{ locale, currency, unit, min-fraction-digits,
 *   max-fraction-digits }`, or an older `",.2f"` string.
 * @param defaultLocale - the locale when `format` names none (usually the
 *   page's language, {@link elementLanguage}); `undefined` means the browser's.
 * @returns the formatted text. An option Intl rejects (an unknown currency or
 *   unit, a malformed locale) is dropped with one console warning, never thrown.
 *
 * @example
 * ```ts
 * formatNumber(1234567.891, { locale: "de-DE", "max-fraction-digits": 1 }); // "1.234.567,9"
 * formatNumber(12.5, { currency: "EUR" }, "fr");                            // "12,50 €"
 * formatNumber(10, {}, "en") + "–" + formatNumber(25, {}, "en");            // "10–25"
 * ```
 */
export function formatNumber(value: number, format: NumberFormat = {}, defaultLocale?: string): string {
  if (!Number.isFinite(value)) return String(value);
  let options: NumberFormatOptions;
  let grouping = true;
  if (typeof format === "string") {
    const legacy = legacyNumberFormat(format);
    grouping = legacy.grouping;
    options = legacy;
  } else {
    options = format && typeof format === "object" ? format : {};
  }
  const fallbackLocale = normalizeLocale(defaultLocale);
  const locale = normalizeLocale(options.locale) ?? fallbackLocale;
  const intl = toIntlNumberFormatOptions(options);
  if (!grouping) intl.useGrouping = false;
  try {
    return formatter(locale, intl).format(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const key = `${locale}|${JSON.stringify(intl)}`;
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(
        `[maplibre-yaml] number format ${JSON.stringify(format)} isn't usable here (${message}); ` +
          "showing the number with what can be kept of it."
      );
    }
    // Keep what can be kept, in steps: the options under the default locale,
    // then the browser's; then grouping and fraction digits alone (an
    // unknown currency or unit) under each; `String()` only last.
    const plain: Intl.NumberFormatOptions = {};
    for (const k of ["useGrouping", "minimumFractionDigits", "maximumFractionDigits"] as const) {
      if (intl[k] !== undefined) (plain as Record<string, unknown>)[k] = intl[k];
    }
    const attempts: Array<[string | undefined, Intl.NumberFormatOptions]> = [
      [fallbackLocale, intl],
      [undefined, intl],
      [locale, plain],
      [fallbackLocale, plain],
      [undefined, plain],
    ];
    for (const [l, o] of attempts) {
      if (l === locale && o === intl) continue;
      try {
        return formatter(l, o).format(value);
      } catch {
        /* next step */
      }
    }
    return String(value);
  }
}
