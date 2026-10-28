/**
 * @file The `convert` chunk: what `getDecoder("convert")` hands the entry
 * @module @maplibre-yaml/core/convert/chunk
 *
 * @description
 * The printers and the loss rules, loaded only when a document is converted
 * (`convertDocument`, `mlym convert`, the playground's language toggle), so
 * no page that only shows maps downloads them (KTD9). The entry reads the
 * author's text into an {@link AuthoredDocument} (convert/tree.ts) and calls
 * {@link convertTree} with it.
 *
 * This chunk imports core for types only: a value import would make the
 * build share code with the entry through a file every page downloads
 * (tests/lazy-chunks.test.ts).
 */

import type { DocumentFormat } from "../parser/yaml-parser";
import type { AuthoredDocument, ConvertOutcome } from "./types";
import { checkFor } from "./losses";
import { printJson } from "./print-json";
import { printToml } from "./print-toml";
import { printYaml } from "./print-yaml";

/** Print `doc` as `to`, with what was lost, or why it cannot be written. */
export function convertTree(doc: AuthoredDocument, to: DocumentFormat): ConvertOutcome {
  const { root, losses, errors } = checkFor(doc, to);
  if (errors.length > 0) return { ok: false, errors, losses };
  const text =
    to === "json"
      ? printJson(root, doc.schema)
      : to === "toml"
        ? printToml(root as Extract<typeof root, { kind: "map" }>, doc.schema)
        : printYaml(root, doc.schema);
  return { ok: true, text, losses };
}
