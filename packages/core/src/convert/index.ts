/**
 * @file Convert a document between YAML, JSON and TOML
 * @module @maplibre-yaml/core/convert
 *
 * @description
 * {@link convertDocument} writes the document the author wrote in another
 * format, keeping expressions inline so the output stays readable, and
 * reports what the target cannot keep (comments, anchors, some nulls). It
 * validates the input too, and returns that result beside the output:
 * `mlym convert` refuses to write an invalid document, while the playground
 * converts one anyway.
 *
 * This half reads the text (convert/tree.ts) and runs in the entry; the
 * printers and the loss rules are the lazy `convert` chunk. No element
 * imports this module, so no map page downloads either.
 */

import { getDecoder } from "../formats/decoders";
import { isFormatError } from "../formats/errors";
import { parseDocumentText, type DocumentSignals, type DocumentTextResult } from "../parser/document-text";
import type { DocumentFormat, ParseError } from "../parser/yaml-parser";
import { tomlTree, yamlTree } from "./tree";
import type { ConvertError, ConvertLoss } from "./types";

export type { ConvertError, ConvertLoss } from "./types";

export interface ConvertOptions {
  /** The input's format, when the caller knows it. Else `signals`, else the text decides. */
  from?: DocumentFormat;
  /** The format to write. */
  to: DocumentFormat;
  /** Where the text came from (a file name, a URL), as {@link parseDocumentText} takes them. */
  signals?: DocumentSignals;
}

/** What {@link convertDocument} returns. */
export type ConvertResult =
  | {
      success: true;
      from: DocumentFormat;
      to: DocumentFormat;
      /** The document in the target format, ending in a newline. */
      text: string;
      /** What the output does not keep. Not fatal; `mlym convert --strict` makes it so. */
      losses: ConvertLoss[];
      /** The input's validation. The output is written even when it has errors. */
      validation: DocumentTextResult;
    }
  | {
      success: false;
      from: DocumentFormat;
      to: DocumentFormat;
      /** A syntax error in the input, or the values the target format cannot hold, each with its path. */
      errors: Array<ParseError | ConvertError>;
      losses: ConvertLoss[];
      validation: DocumentTextResult;
    };

/** Errors that mean the text is not a document at all: nothing to convert. */
const UNREADABLE = new Set(["yaml-syntax", "toml-syntax", "yaml-expansion", "yaml-merge"]);

const FORMATS = new Set<string>(["yaml", "json", "toml"]);

/**
 * Convert document text to YAML, JSON or TOML.
 *
 * @remarks
 * The output is the authored document, not the validated one: no defaults
 * are filled in and no sugar is expanded. Any document that parses converts,
 * whether or not it validates; `validation` says which.
 *
 * Losses are reported, not fatal: comments (with their lines), each alias and
 * merge key (written out in full), and, going to TOML, a null where leaving
 * the key out means the same thing (a `setFilter` action's `filter`, a
 * GeoJSON feature's property). The conversion fails, naming the path, for any
 * other null going to TOML, `inf` or `nan` going to JSON, and an integer past
 * 2^53. `!html` converts to `{"$html": …}` and back, so it is not a loss.
 *
 * The promise never rejects because of what the text says. It rejects only
 * when a reader chunk cannot be downloaded (a `FormatError` of code
 * `"chunk"`).
 *
 * @example
 * ```typescript
 * const result = await convertDocument(yamlText, { to: "toml" });
 * if (result.success) {
 *   for (const loss of result.losses) console.warn(loss.message);
 *   console.log(result.text);
 * }
 * ```
 */
export async function convertDocument(text: string, options: ConvertOptions): Promise<ConvertResult> {
  const validation = await parseDocumentText(text, {
    ...(options.from ? { format: options.from } : {}),
    ...(options.signals ? { signals: options.signals } : {}),
  });
  const from = validation.format;
  const to = options.to;
  const failed = (errors: Array<ParseError | ConvertError>, losses: ConvertLoss[] = []): ConvertResult => ({
    success: false,
    from,
    to,
    errors,
    losses,
    validation,
  });

  if (!FORMATS.has(to)) {
    return failed([{ path: "", message: `Cannot convert to "${String(to)}": choose yaml, json or toml.` }]);
  }
  const errors = validation.result.errors;
  if (errors.some((e) => e.code !== undefined && UNREADABLE.has(e.code))) return failed(errors);

  try {
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    let doc;
    if (from === "toml") {
      const read = (await getDecoder("toml")).readToml(body);
      doc = read.ok ? tomlTree(body, read) : undefined;
    } else {
      doc = yamlTree(body, from);
    }
    // Empty text, or text that holds no document: validation says why.
    if (!doc) return failed(errors.length > 0 ? errors : [{ path: "", message: "The document is empty." }]);
    const outcome = (await getDecoder("convert")).convertTree(doc, to);
    return outcome.ok
      ? { success: true, from, to, text: outcome.text, losses: outcome.losses, validation }
      : failed(outcome.errors, outcome.losses);
  } catch (error) {
    if (isFormatError(error) && error.failure.code === "chunk") throw error;
    return failed([
      { path: "", message: `The document could not be converted: ${error instanceof Error ? error.message : String(error)}` },
    ]);
  }
}
