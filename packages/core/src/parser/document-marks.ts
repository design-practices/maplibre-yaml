/**
 * @file Whether JSON or TOML text is a map or story document, from its text
 * @module @maplibre-yaml/core/parser/document-marks
 *
 * @description
 * The rule `mlym validate` uses to pick documents out of a folder's `.json`
 * and `.toml` files (KTD11), and the docs' snippet check uses to pick
 * document fences: judged from the raw text, not a parse, so a document with
 * a syntax error is still recognized (and then fails validation) rather than
 * silently skipped. No element imports this module.
 */

/** A `$schema` (or TOML `#:schema` directive) under this site's schema folder. */
const SCHEMA_URL = String.raw`https?://docs\.maplibre-yaml\.org/schema/`;

const DOCUMENT_MARKS: Record<"json" | "toml", RegExp[]> = {
  json: [
    /"type"\s*:\s*"(?:map|scrollytelling)"/,
    /"pages"\s*:\s*\[/,
    new RegExp(String.raw`"\$schema"\s*:\s*"` + SCHEMA_URL),
  ],
  toml: [
    /^type[ \t]*=[ \t]*["'](?:map|scrollytelling)["']/m,
    /^(?:pages[ \t]*=|\[\[[ \t]*pages[ \t]*\]\])/m,
    new RegExp(String.raw`^(?:#:schema[ \t]+|["']\$schema["'][ \t]*=[ \t]*["'])` + SCHEMA_URL, "m"),
  ],
};

/**
 * Whether JSON or TOML text reads as a map or story document: it names a
 * `type` of `map` or `scrollytelling`, has a top-level `pages` key, or
 * carries a `$schema` (in TOML, also a `#:schema` directive) under
 * docs.maplibre-yaml.org/schema/.
 *
 * @remarks
 * The text is tested as given: a caller reading a file strips its
 * byte-order mark first (core's `stripBom`).
 */
export function looksLikeDocumentText(text: string, format: "json" | "toml"): boolean {
  return DOCUMENT_MARKS[format].some((mark) => mark.test(text));
}
