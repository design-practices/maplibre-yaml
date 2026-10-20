/**
 * Numbers via Intl with MapLibre's `number-format` vocabulary (0.9): the
 * formatter popups use, and the one helper the classify workstream calls
 * for generated legend labels.
 */
import { describe, it, expect, vi } from "vitest";
import {
  formatNumber,
  legacyNumberFormat,
  toIntlNumberFormatOptions,
} from "../../src/i18n";

// Intl output uses narrow no-break spaces in some locales; compare loosely.
const norm = (s: string) => s.replace(/[  ]/g, " ");

describe("formatNumber", () => {
  it("de-DE: decimal comma, dot grouping", () => {
    expect(formatNumber(1234567.891, { locale: "de-DE", "max-fraction-digits": 1 })).toBe("1.234.567,9");
  });

  it("currency", () => {
    expect(formatNumber(12.5, { currency: "EUR", locale: "en-US" })).toBe("€12.50");
    expect(norm(formatNumber(12.5, { currency: "EUR", locale: "de-DE" }))).toBe("12,50 €");
    expect(formatNumber(1200, { currency: "JPY", locale: "en-US" })).toBe("¥1,200");
  });

  it("fraction digits", () => {
    expect(formatNumber(3.14159, { locale: "en-US", "max-fraction-digits": 2 })).toBe("3.14");
    expect(formatNumber(3, { locale: "en-US", "min-fraction-digits": 2 })).toBe("3.00");
    expect(formatNumber(3.14159, { locale: "en-US", "min-fraction-digits": 1, "max-fraction-digits": 1 })).toBe("3.1");
    // max below the currency default min: no RangeError on any engine.
    expect(formatNumber(12.5, { currency: "USD", locale: "en-US", "max-fraction-digits": 0 })).toBe("$13");
    // min above max is lifted, never thrown.
    expect(formatNumber(1.5, { locale: "en-US", "min-fraction-digits": 3, "max-fraction-digits": 1 })).toBe("1.500");
  });

  it("unit (MapLibre number-format `unit`); currency wins over unit", () => {
    expect(norm(formatNumber(1234.5, { unit: "kilometer", locale: "fr", "max-fraction-digits": 1 }))).toBe(
      "1 234,5 km"
    );
    expect(formatNumber(5, { currency: "USD", unit: "kilometer", locale: "en-US" })).toBe("$5.00");
  });

  it("the default locale applies when the format names none", () => {
    expect(formatNumber(1234.5, {}, "de-DE")).toBe("1.234,5");
    expect(formatNumber(1234.5, { locale: "en-US" }, "de-DE")).toBe("1,234.5");
  });

  it("the older d3-style string keeps working, now in the page's locale", () => {
    expect(formatNumber(1234567.891, ",.0f", "en-US")).toBe("1,234,568");
    expect(formatNumber(1234567.891, ",.2f", "en-US")).toBe("1,234,567.89");
    expect(formatNumber(1234.5, ".2f", "en-US")).toBe("1234.50");
    expect(formatNumber(1234567.891, ",.0f", "de-DE")).toBe("1.234.568");
    expect(legacyNumberFormat(",.3f")).toEqual({
      grouping: true,
      "min-fraction-digits": 3,
      "max-fraction-digits": 3,
    });
  });

  it("a format Intl rejects warns once and falls back, never throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(formatNumber(5, { currency: "NOTACURRENCY", locale: "en-US" }, "en-US")).toBe("5");
    expect(formatNumber(6, { currency: "NOTACURRENCY", locale: "en-US" }, "en-US")).toBe("6");
    expect(formatNumber(7, { unit: "furlongs-per-fortnight" }, "en-US")).toBe("7");
    expect(formatNumber(1234, {}, "not a locale!!")).toBe("1234");
    expect(warn.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(3);
    warn.mockRestore();
  });

  it("non-finite values pass through", () => {
    expect(formatNumber(Number.NaN, { locale: "de-DE" })).toBe("NaN");
    expect(formatNumber(Infinity, {})).toBe("Infinity");
  });

  it("maps option names onto Intl.NumberFormat options", () => {
    expect(
      toIntlNumberFormatOptions({ currency: "EUR", "min-fraction-digits": 1, "max-fraction-digits": 3 })
    ).toEqual({ style: "currency", currency: "EUR", minimumFractionDigits: 1, maximumFractionDigits: 3 });
    expect(toIntlNumberFormatOptions({ unit: "percent" })).toEqual({ style: "unit", unit: "percent" });
    expect(toIntlNumberFormatOptions({})).toEqual({});
  });

  it("legend edges for the classify workstream: two numbers and a dash", () => {
    const edge = (a: number, b: number, locale: string) =>
      `${formatNumber(a, { "max-fraction-digits": 1 }, locale)}–${formatNumber(b, { "max-fraction-digits": 1 }, locale)}`;
    expect(edge(10, 25, "en")).toBe("10–25");
    expect(edge(1000.25, 2500.5, "de")).toBe("1.000,3–2.500,5");
  });
});
