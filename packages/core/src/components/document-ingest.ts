/**
 * @file Reading a document for `<ml-map>` and `<ml-scrollytelling>`
 * @module @maplibre-yaml/core/components/document-ingest
 *
 * @description
 * Both elements take a document from `src`, an inline script, the `config`
 * attribute or property, and (`<ml-map>`) `update()`. In every case the text
 * goes through the one front door, {@link parseDocumentText}, so YAML, JSON
 * and TOML read the same way everywhere (KTD3, KTD8). The two steps they
 * share live here:
 *
 * - {@link fetchDocument}: fetch `src`, or the card for the way it failed;
 * - {@link readDocument}: read text, or report that the TOML reader couldn't
 *   be downloaded.
 *
 * YAML and JSON are read in the same turn, as they always were. A TOML read
 * waits for its reader, so each element bumps its own generation counter
 * before it starts one and drops a result that a newer document overtook.
 */

import {
  parseDocumentText,
  readDocumentTextNow,
  signalledFormat,
  type DocumentSignals,
  type FormattedParseResult,
} from "../parser/document-text.js";
import type { MapBlock, ScrollytellingBlock } from "../parser/yaml-parser.js";
import { getDecoder } from "../formats/decoders.js";
import { resolveDocumentUrl } from "../utils/document-base.js";
import {
  isFilePage,
  looksLikeHtml,
  resolveUrl,
  srcFetchFailedCard,
  srcHtmlCard,
  srcHttpErrorCard,
  type ErrorCardContent,
} from "./student-messages.js";

/** Document text and what is known about where it came from. */
export interface DocumentText {
  text: string;
  signals: DocumentSignals;
  /** The TOML reader, already downloading (a `.toml` URL seen before the fetch). */
  reader?: Promise<unknown> | undefined;
  /** The resolved `src` URL, for a fetched document. */
  url?: string;
}

/** A `src` that didn't load: the card, the URL the browser asked for, and why in a few words. */
export interface FetchFailure {
  failed: ErrorCardContent;
  resolved: string;
  reason: string;
}

/** What {@link readDocument} returns: the parse result, or the TOML reader's download failure. */
export type ReadResult<T> = FormattedParseResult<T> | { chunk: unknown };

/**
 * Fetch a `src` document. Each way a fetch fails gets its own card
 * (ml-aot.13). A `.toml` URL starts the TOML reader's download alongside the
 * fetch, so the document renders one round trip sooner (KTD8).
 */
export async function fetchDocument(
  src: string,
  base: string | null,
  doc: Document
): Promise<DocumentText | FetchFailure> {
  // With a `base`, `src` is a site path like every path inside the document.
  const target = resolveDocumentUrl(src, base);
  const resolved = resolveUrl(target, doc.baseURI);
  const context = { pageUrl: doc.baseURI, base };
  let reader: Promise<unknown> | undefined;
  if (signalledFormat({ url: target }) === "toml") {
    reader = getDecoder("toml");
    reader.catch(() => undefined);
  }
  let response: Response;
  let text: string;
  try {
    response = await fetch(target);
    if (!response.ok) {
      return {
        failed: srcHttpErrorCard(src, resolved, response.status, response.statusText, context),
        resolved,
        reason: `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
      };
    }
    text = await response.text();
  } catch (error) {
    return {
      failed: srcFetchFailedCard(src, resolved, error, isFilePage(doc)),
      resolved,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const contentType = response.headers?.get?.("content-type") ?? null;
  if (looksLikeHtml(text, contentType)) {
    return { failed: srcHtmlCard(src, resolved, context), resolved, reason: "it is a web page, not a YAML file" };
  }
  return { text, url: resolved, reader, signals: { url: target, responseUrl: response.url, contentType } };
}

/**
 * Read document text in any format: at once for YAML and JSON, a promise
 * for TOML. That resolves `{ chunk }` when the TOML reader couldn't be
 * downloaded, the one failure that is not about the text.
 */
export function readDocument<K extends "map" | "story">(
  doc: DocumentText,
  kind: K
): ReadResult<K extends "map" ? MapBlock : ScrollytellingBlock> | Promise<ReadResult<K extends "map" ? MapBlock : ScrollytellingBlock>> {
  const options = { kind: kind as "map", signals: doc.signals };
  const now = doc.reader ? undefined : readDocumentTextNow(doc.text, options);
  if (now) return now as never;
  return Promise.resolve(doc.reader)
    .then(() => parseDocumentText(doc.text, options))
    .catch((chunk: unknown) => ({ chunk })) as never;
}

/** `next(value)`, at once for a value, once it resolves for a promise: keeps a YAML read in the same turn. */
export function after<T, U>(value: T | Promise<T>, next: (value: T) => U | Promise<U>): U | Promise<U> {
  return value instanceof Promise ? value.then(next) : next(value);
}
