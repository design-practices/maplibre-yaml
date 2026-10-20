/**
 * @file Locale-aware number formatting — the one helper legends format through
 * @module @maplibre-yaml/core/utils/format-number
 *
 * @description
 * One function, {@link formatNumber}, over `Intl.NumberFormat`, taking the
 * style spec's own `number-format` option names (`locale`, `currency`,
 * `unit`, `min-fraction-digits`, `max-fraction-digits`) so what an author
 * learns here is what MapLibre's `["number-format", …]` expression takes.
 *
 * It is deliberately the single seam: the language/accessibility work
 * (0.9 i18n) adds a document locale and may replace this body; every caller
 * goes through this function, so that change is made in one place.
 */

/** MapLibre `number-format` options (style spec), as authored in YAML. */
export interface NumberFormatOptions {
  /** BCP 47 locale, e.g. `en-US`, `de`. Default: the reader's own locale. */
  locale?: string;
  /** ISO 4217 currency code, e.g. `USD` — formats as currency. */
  currency?: string;
  /** A sanctioned `Intl` unit, e.g. `percent`, `kilometer` — appended to the number. */
  unit?: string;
  "min-fraction-digits"?: number;
  "max-fraction-digits"?: number;
}

/** Translate spec option names to `Intl.NumberFormatOptions`. */
function intlOptions(options: NumberFormatOptions): Intl.NumberFormatOptions {
  const out: Intl.NumberFormatOptions = {};
  if (options.currency) {
    out.style = "currency";
    out.currency = options.currency;
  } else if (options.unit) {
    out.style = "unit";
    out.unit = options.unit;
  }
  const min = options["min-fraction-digits"];
  const max = options["max-fraction-digits"];
  if (min !== undefined) out.minimumFractionDigits = min;
  if (max !== undefined) out.maximumFractionDigits = Math.max(max, min ?? 0);
  return out;
}

/**
 * Why a set of options cannot format, or `null` when it can (an unknown
 * currency or unit, an unusable locale). For validation messages.
 */
export function numberFormatProblem(options: NumberFormatOptions): string | null {
  try {
    new Intl.NumberFormat(options.locale, intlOptions(options));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Format a number for display (legend edges, labels).
 *
 * @remarks
 * Never throws: options that `Intl` rejects (validation reports them) fall
 * back to the locale's plain decimal format rather than blanking a legend.
 */
export function formatNumber(value: number, options: NumberFormatOptions = {}): string {
  if (!Number.isFinite(value)) return String(value);
  try {
    return new Intl.NumberFormat(options.locale, intlOptions(options)).format(value);
  } catch {
    try {
      return new Intl.NumberFormat(options.locale).format(value);
    } catch {
      return String(value);
    }
  }
}
