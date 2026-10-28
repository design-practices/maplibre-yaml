/**
 * @file Print an authored tree as JSON
 * @module @maplibre-yaml/core/convert/print-json
 *
 * @description
 * Two-space JSON, except that any array or object that fits on its line
 * within 80 columns stays on it: expressions read as they do in YAML
 * (`["get", "mag"]`), instead of one token per line as
 * `JSON.stringify(v, null, 2)` prints them. The schema hint becomes a first
 * `"$schema"` key; `!html` becomes `{ "$html": "…" }`.
 *
 * Part of the lazy `convert` chunk: core is imported for types only.
 */

import type { AuthoredNode } from "./types";
import { numberText } from "./print-yaml";
import { WIDTH, fillLines } from "./wrap";

const quote = (s: string) => JSON.stringify(s);

function inline(node: AuthoredNode): string {
  switch (node.kind) {
    case "map":
      return node.entries.length === 0
        ? "{}"
        : `{ ${node.entries.map((e) => `${quote(e.key)}: ${inline(e.value)}`).join(", ")} }`;
    case "seq":
      return `[${node.items.map(inline).join(", ")}]`;
    case "html":
      return `{ "$html": ${quote(node.value)} }`;
    case "string":
      return quote(node.value);
    case "number":
      return numberText(node);
    case "boolean":
      return String(node.value);
    case "null":
      return "null";
  }
}

/** `node` at `indent`, after `prefix` columns of key on its first line. */
function block(node: AuthoredNode, indent: number, prefix: number, top = false): string {
  const one = inline(node);
  if (node.kind !== "map" && node.kind !== "seq") return one;
  const empty = node.kind === "map" ? node.entries.length === 0 : node.items.length === 0;
  // One more column for a trailing comma.
  if (empty || (!top && indent + prefix + one.length + 1 <= WIDTH)) return one;
  const pad = " ".repeat(indent + 2);
  const lines =
    node.kind === "map"
      ? node.entries.map((e) => {
          const key = `${quote(e.key)}: `;
          return pad + key + block(e.value, indent + 2, key.length);
        })
      : node.items.some((item) => item.kind === "map")
        ? node.items.map((item) => pad + block(item, indent + 2, 0))
        : // An expression: as many items to a line as fit, so `["interpolate", ["linear"],
          // ["get", "mag"], 1, 2, 7, 20]` takes two lines, not nine. One too long wraps by itself.
          fillLines(node.items, indent + 2, inline).map(
            (line) => pad + (typeof line === "string" ? line : block(line.item, indent + 2, 0))
          );
  const [open, close] = node.kind === "map" ? ["{", "}"] : ["[", "]"];
  return `${open}\n${lines.join(",\n")}\n${" ".repeat(indent)}${close}`;
}

/** The document as JSON text, ending in a newline. */
export function printJson(root: AuthoredNode, schema: string | undefined): string {
  const withSchema: AuthoredNode =
    schema !== undefined && root.kind === "map"
      ? { ...root, entries: [{ key: "$schema", value: { kind: "string", value: schema } }, ...root.entries] }
      : root;
  return `${block(withSchema, 0, 0, true)}\n`;
}
