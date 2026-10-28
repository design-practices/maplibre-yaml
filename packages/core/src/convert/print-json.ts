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

const WIDTH = 80;

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
        : fill(node.items, indent + 2).map((line) => pad + line);
  const [open, close] = node.kind === "map" ? ["{", "}"] : ["[", "]"];
  return `${open}\n${lines.join(",\n")}\n${" ".repeat(indent)}${close}`;
}

/**
 * A list with no object in it (an expression), wrapped: as many items to a
 * line as fit, so `["interpolate", ["linear"], ["get", "mag"], 1, 2, 7, 20]`
 * takes two lines, not nine. An item too long for a line of its own wraps
 * by itself.
 */
function fill(items: AuthoredNode[], indent: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const item of items) {
    const text = inline(item);
    if (indent + text.length + 1 > WIDTH) {
      if (line) lines.push(line);
      line = "";
      lines.push(block(item, indent, 0));
    } else if (line === "") {
      line = text;
    } else if (indent + line.length + 2 + text.length + 1 <= WIDTH) {
      line += `, ${text}`;
    } else {
      lines.push(line);
      line = text;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The document as JSON text, ending in a newline. */
export function printJson(root: AuthoredNode, schema: string | undefined): string {
  const withSchema: AuthoredNode =
    schema !== undefined && root.kind === "map"
      ? { ...root, entries: [{ key: "$schema", value: { kind: "string", value: schema } }, ...root.entries] }
      : root;
  return `${block(withSchema, 0, 0, true)}\n`;
}
