/**
 * @file A document's raw value, in YAML, JSON or TOML
 * @module @maplibre-yaml/core/parser/document-value
 *
 * @description
 * {@link readDocumentValue} reads document text the way
 * {@link parseDocumentText} does (the same format detection, the same
 * syntax-error wording, the same guards) and returns the value as written,
 * without validating or normalizing it. For a host that returns a file's
 * data unvalidated (Astro's `loadYAML`), so all three formats give the same
 * value for the same data:
 *
 * - **YAML and JSON** are materialized with validation's guards: a merge
 *   fan-out (`<<: [*a, *b]`) is refused and aliases count against the alias
 *   budget. `!html "…"` is `{ $html: "…" }`.
 * - **TOML** is the reader's value, from the reader chunk loaded on first
 *   use: dates stay the text as written, `{ "$html" = "…" }` is the same
 *   `{ $html: "…" }`, a key named `<<` is a key, and an integer past 2^53 is
 *   a number (as JavaScript reads it).
 *
 * A root `$schema` is kept. Entry side only: the elements never import this
 * file, so it stays out of `register.browser.js`.
 */

import { getDecoder } from "../formats/decoders";
import {
  detectDocumentFormat,
  scanJsonText,
  scanProblem,
  stripBom,
  withTomlLabelHintOn,
  wordYamlOrJsonErrors,
  type DocumentSignals,
  type TomlReader,
} from "./document-text";
import { materializeYamlValue, type DocumentFormat, type ParseError } from "./yaml-parser";

export interface ReadDocumentValueOptions {
  /** The format, when the caller knows it. Beats every signal. */
  format?: DocumentFormat;
  /** Where the text came from, as for {@link parseDocumentText}. */
  signals?: DocumentSignals;
}

/** What {@link readDocumentValue} resolves to. Every error carries `format`. */
export type DocumentValueResult =
  | { success: true; value: unknown; format: DocumentFormat }
  | { success: false; errors: ParseError[]; format: DocumentFormat };

/**
 * Read document text in YAML, JSON or TOML as a plain value, without
 * validating or normalizing it.
 *
 * @remarks
 * The format is picked as {@link parseDocumentText} picks it: `format`, else
 * the `signals`, else the text itself. Empty YAML or JSON is `null`; empty
 * TOML is an empty table.
 *
 * The promise never rejects because of what the text says: a syntax error,
 * a refused merge fan-out or an alias bomb resolve as `{ success: false }`,
 * with the errors worded for the format and positioned. A failed download
 * of the TOML reader rejects, as it does for {@link parseDocumentText}.
 *
 * @example
 * ```typescript
 * const read = await readDocumentValue(text, { signals: { fileName: "data.toml" } });
 * if (read.success) use(read.value);
 * else console.error(read.errors[0].message);
 * ```
 */
export async function readDocumentValue(
  text: string,
  options: ReadDocumentValueOptions = {}
): Promise<DocumentValueResult> {
  let format: DocumentFormat = "yaml";
  let body = "";
  try {
    if (typeof text !== "string") throw new TypeError("expected the document as text");
    body = stripBom(text);
    format = detectDocumentFormat(body, options);
  } catch (err) {
    return unreadable(err, format);
  }
  // Outside the try: a failed download of the reader is the one rejection.
  const toml = format === "toml" ? await getDecoder("toml") : undefined;
  try {
    return toml ? readTomlValue(toml, body) : readYamlOrJsonValue(body, format as "yaml" | "json");
  } catch (err) {
    return unreadable(err, format);
  }
}

function readYamlOrJsonValue(text: string, format: "yaml" | "json"): DocumentValueResult {
  const scan = scanJsonText(text, format);
  const problem = scanProblem(scan);
  if (problem) return failed([problem], format);
  const read = materializeYamlValue(text);
  if ("error" in read) return failed(wordYamlOrJsonErrors(text, format, [read.error], scan), format);
  return { success: true, value: read.value, format };
}

function readTomlValue(toml: TomlReader, text: string): DocumentValueResult {
  const read = toml.readToml(text);
  if (!read.ok) return failed(withTomlLabelHintOn(text, [read.error]), "toml");
  return { success: true, value: read.value, format: "toml" };
}

function failed(errors: ParseError[], format: DocumentFormat): DocumentValueResult {
  return { success: false, errors: errors.map((err) => ({ ...err, format })), format };
}

function unreadable(err: unknown, format: DocumentFormat): DocumentValueResult {
  const message = `The document could not be read: ${err instanceof Error ? err.message : String(err)}`;
  return failed([{ path: "", message }], format);
}
