/**
 * @file What a conversion loses, and what it cannot write at all
 * @module @maplibre-yaml/core/convert/losses
 *
 * @description
 * Before printing, the authored tree is checked against the target format:
 *
 * - **Losses** (reported; the output is still written): every comment, every
 *   alias and merge key (written out in full), and, for TOML, a null where
 *   leaving the key out means the same thing (R16): a `setFilter` action's
 *   `filter`, and a GeoJSON feature's `properties` or one of its values.
 * - **Failures** (nothing is written), each naming its path: any other null
 *   going to TOML, `inf` or `nan` going to JSON, and an integer literal past
 *   2^53 (the value read has already lost digits, whatever the target).
 *
 * `!html` is not a loss: it prints as `{"$html": …}` and reads back the same.
 *
 * Part of the lazy `convert` chunk: core is imported for types only.
 */

import type { DocumentFormat } from "../parser/yaml-parser";
import type { AuthoredDocument, AuthoredNode, ConvertError, ConvertLoss, SourceAt } from "./types";
import { nonFiniteLabel } from "./print-yaml";

type Segment = string | number;
type MapNode = Extract<AuthoredNode, { kind: "map" }>;

const pathOf = (path: readonly Segment[]) => path.join(".");
const where = (at: SourceAt | undefined) => (at ? { line: at.line, column: at.column } : {});

/** A map's string value at `key`. */
function stringAt(map: MapNode | undefined, key: string): string | undefined {
  const value = map?.entries.find((e) => e.key === key)?.value;
  return value?.kind === "string" ? value.value : undefined;
}

/**
 * Why leaving out the null at `key` of `map` means the same as the null, or
 * undefined when it does not. `parent` is the map holding `map`, under
 * `parentKey`.
 */
function droppableNull(map: MapNode, key: string, parent: MapNode | undefined, parentKey: Segment | undefined): string | undefined {
  if (key === "filter" && stringAt(map, "action") === "setFilter") {
    return "the filter is left out, which clears the layer's filter just as null does";
  }
  if (key === "properties" && stringAt(map, "type") === "Feature") {
    return "the feature's properties are left out, which reads the same as null";
  }
  if (parentKey === "properties" && stringAt(parent, "type") === "Feature") {
    return "the property is left out, which reads the same as null";
  }
  return undefined;
}

/** The tree to print (nulls dropped where allowed), with the losses, or the failures. */
export function checkFor(
  doc: AuthoredDocument,
  to: DocumentFormat
): { root: AuthoredNode; losses: ConvertLoss[]; errors: ConvertError[] } {
  const losses: ConvertLoss[] = [];
  const errors: ConvertError[] = [];

  for (const comment of doc.comments) {
    losses.push({
      kind: "comment",
      message: `the comment on line ${comment.at.line} is dropped: ${clip(comment.text)}`,
      ...where(comment.at),
    });
  }
  for (const x of doc.expansions) {
    losses.push(
      x.kind === "merge"
        ? {
            kind: "merge",
            message: `the merge key \`<<: *${x.name}\` on line ${x.at.line} is written out in full`,
            ...where(x.at),
          }
        : {
            kind: "anchor",
            message: `the alias \`*${x.name}\` on line ${x.at.line} is written out in full`,
            ...where(x.at),
          }
    );
  }

  const fail = (code: ConvertError["code"], path: readonly Segment[], message: string, at?: SourceAt) =>
    errors.push({ code, path: pathOf(path), message, ...where(at) });

  /** `parent` is the map that holds `node` (under the last segment of `path`), if a map does. */
  const visit = (node: AuthoredNode, path: Segment[], parent: MapNode | undefined): AuthoredNode => {
    switch (node.kind) {
      case "number":
        if (node.unsafe !== undefined) {
          fail(
            "convert-number",
            path,
            `the integer ${node.unsafe} is larger than 2^53 (9007199254740992), so it cannot be read without ` +
              "losing digits. Write it as a string, or as a smaller number.",
            node.at
          );
        } else if (!Number.isFinite(node.value) && to === "json") {
          fail(
            "convert-number",
            path,
            `JSON has no ${nonFiniteLabel(node.value)}. Write a number, or keep the document in YAML or TOML.`,
            node.at
          );
        }
        return node;
      case "null":
        if (to === "toml") {
          fail(
            "convert-null",
            path,
            "TOML has no null, and leaving this value out would change the document. Change the value, " +
              "or keep the document in YAML or JSON.",
            node.at
          );
        }
        return node;
      case "seq":
        return { ...node, items: node.items.map((item, i) => visit(item, [...path, i], undefined)) };
      case "map": {
        const entries = [];
        for (const entry of node.entries) {
          const at = [...path, entry.key];
          if (entry.value.kind === "null" && to === "toml") {
            const why = droppableNull(node, entry.key, parent, path[path.length - 1]);
            if (why !== undefined) {
              losses.push({
                kind: "null",
                path: pathOf(at),
                message: `${pathOf(at)}: null dropped — TOML has no null; ${why}`,
                ...where(entry.at ?? entry.value.at),
              });
              continue;
            }
          }
          entries.push({ ...entry, value: visit(entry.value, at, node) });
        }
        return { ...node, entries };
      }
      default:
        return node;
    }
  };

  const root = visit(doc.root, [], undefined);
  if (to === "toml" && root.kind !== "map") {
    fail(
      "convert-shape",
      [],
      `A TOML document is a table, and this document's top level is ${root.kind === "seq" ? "a list" : "a single value"}.`,
      root.at
    );
  }
  return { root, losses, errors };
}

/** A comment, shortened for one line of a report. */
function clip(text: string): string {
  const one = text.trim();
  return one.length > 60 ? `${one.slice(0, 57)}…` : one;
}
