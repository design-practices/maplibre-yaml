/**
 * @file A parsed document as text the element's attribute parser reads back whole
 * @module @maplibre-yaml/core/parser
 *
 * @description
 * The Astro components and `<ml-scrollytelling>` hand a document they have
 * already parsed to `<ml-map>` through its `config` attribute, as text. That
 * text is read as a document in any format, and JSON-shaped text goes
 * through the YAML parser (JSON is YAML). `JSON.stringify` alone loses one
 * value a document can hold: `Infinity`, which it writes as `null` — so an
 * open-longitude `maxBounds` (`[-.inf, -60, .inf, 75]`, maplibre-gl 6.16,
 * ml-vwz) arrived as `[null, -60, null, 75]` and was refused.
 *
 * `serializeDocument` is `JSON.stringify` with the two infinities written as
 * YAML's bare tokens `.inf` and `-.inf`, which the attribute parser reads as
 * the numbers again. For a document without them the text is byte-identical
 * to `JSON.stringify`'s, so nothing else changes shape; `NaN` stays `null`,
 * as before. (yaml's own `stringify` would also do, but writes block YAML:
 * larger for inline data, and no longer what today's hosts and tests read
 * as JSON.)
 */

/** Marks ±Infinity through `JSON.stringify`; a value no document string contains (a NUL). */
const INF = "\u0000.inf";
const NEG_INF = "\u0000-.inf";
/** The marker as `JSON.stringify` writes it, quoted and NUL-escaped. */
const MARKED = /"\\u0000(-?\.inf)"/g;

/**
 * `JSON.stringify(value)`, with `Infinity` and `-Infinity` as the YAML tokens
 * `.inf` and `-.inf`, so the text reads back as the same document.
 */
export function serializeDocument(value: unknown): string {
  const text = JSON.stringify(value, (_key, v: unknown) =>
    v === Infinity ? INF : v === -Infinity ? NEG_INF : v
  );
  return text.replace(MARKED, "$1");
}
