/**
 * @file Print an authored tree as TOML 1.0
 * @module @maplibre-yaml/core/convert/print-toml
 *
 * @description
 * TOML 1.0, which every TOML reader accepts (1.1 adds multi-line inline
 * tables, which this never writes):
 *
 * - **A table's own values come first**, then its sub-tables: a key written
 *   after a `[header]` belongs to that header's table, so TOML forces the
 *   order. Within each group the authored order stands.
 * - **Top-level tables** are `[config]`, `[controls]`, …, and top-level lists
 *   of tables are `[[layers]]`, `[[chapters]]`. Deeper, a table or list that
 *   fits within 80 columns stays inline (`hover = { cursor = "pointer" }`,
 *   `h3 = [{ property = "place" }]`). A list of tables that does not fit is
 *   one inline table per line when each fits, else `[[…]]` tables. A header
 *   with nothing of its own (`[layers.interactive]` above its sub-tables) is
 *   left out, as TOML allows.
 * - **Inline tables are single-line.** Lists may wrap, one item per line,
 *   with a trailing comma.
 * - **Keys** are bare when TOML allows (`circle-radius`), else quoted: a
 *   dotted locale key (`"Popup.Close"`), `"$ref"`, `"$html"`, a key with a
 *   space.
 *
 * The schema hint becomes a `#:schema …` first line, the directive TOML
 * editors (Taplo, Even Better TOML) read. `!html` becomes
 * `{ "$html" = "…" }`. Nulls never get here: losses.ts drops or refuses
 * them first.
 *
 * Part of the lazy `convert` chunk: core is imported for types only.
 */

import type { AuthoredNode } from "./types";
import { nonFiniteLabel, numberText } from "./print-yaml";
import { WIDTH, fillLines } from "./wrap";

type MapNode = Extract<AuthoredNode, { kind: "map" }>;

const pad = (n: number) => " ".repeat(n);

const ESCAPES: Record<string, string> = { "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r", '"': '\\"', "\\": "\\\\" };
const escape = (c: string) => ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;

/** A one-line basic string. */
const basic = (s: string) => `"${s.replace(/[\\"\x00-\x1f\x7f]/g, escape)}"`;

/** A multi-line basic string (`"""`), for text with line breaks directly under a table. */
const multiline = (s: string) => `"""\n${s.replace(/[\\"\x00-\x08\x0b-\x1f\x7f]/g, escape)}"""`;

const key = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : basic(k));

const isTable = (node: AuthoredNode): node is MapNode => node.kind === "map";

function number(node: Extract<AuthoredNode, { kind: "number" }>): string {
  return Number.isFinite(node.value) ? numberText(node) : nonFiniteLabel(node.value);
}

/**
 * A value on the right of `=`, starting at column `column`. `wrap` lets a
 * list that does not fit go one item per line (items at `indent + 2`); inside
 * an inline table nothing wraps.
 */
function value(node: AuthoredNode, column: number, indent: number, wrap: boolean, long = false): string {
  switch (node.kind) {
    case "string":
      return long && node.value.includes("\n") ? multiline(node.value) : basic(node.value);
    case "number":
      return number(node);
    case "boolean":
      return String(node.value);
    case "html":
      return `{ "$html" = ${basic(node.value)} }`;
    case "null":
      // losses.ts refuses every null it does not drop; never printed.
      return '""';
    case "map":
      return node.entries.length === 0
        ? "{}"
        : `{ ${node.entries.map((e) => `${key(e.key)} = ${value(e.value, 0, 0, false)}`).join(", ")} }`;
    case "seq": {
      const one = `[${node.items.map((item) => value(item, 0, 0, false)).join(", ")}]`;
      if (!wrap || column + one.length <= WIDTH || node.items.length === 0) return one;
      const inner = indent + 2;
      if (node.items.some(isTable)) {
        // One inline table per line.
        const items = node.items.map((item) => `${pad(inner)}${value(item, inner, inner, true)},`);
        return `[\n${items.join("\n")}\n${pad(indent)}]`;
      }
      // An expression: as many items to a line as fit; one too long for a line of its own wraps by itself.
      const lines = fillLines(node.items, inner, (item) => value(item, 0, 0, false)).map(
        (line) => `${pad(inner)}${typeof line === "string" ? line : value(line.item, inner, inner, true)},`
      );
      return `[\n${lines.join("\n")}\n${pad(indent)}]`;
    }
  }
}

/** Whether `name = <node>` becomes a section (`[…]` or `[[…]]`) of the table at `depth`, rather than a value. */
function section(name: string, node: AuthoredNode, depth: number): "table" | "tables" | undefined {
  const lead = `${key(name)} = `;
  if (isTable(node) && node.entries.length > 0) {
    return depth === 0 || lead.length + value(node, 0, 0, false).length > WIDTH ? "table" : undefined;
  }
  if (node.kind === "seq" && node.items.length > 0 && node.items.every(isTable)) {
    if (depth === 0) return "tables";
    if (lead.length + value(node, 0, 0, false).length <= WIDTH) return undefined;
    // One inline table per line, if each fits; else `[[…]]`.
    return node.items.some((item) => 2 + value(item, 0, 0, false).length + 1 > WIDTH) ? "tables" : undefined;
  }
  return undefined;
}

/** The document as TOML text, ending in a newline. The root is a table (losses.ts checks). */
export function printToml(root: MapNode, schema: string | undefined): string {
  const out: string[] = schema === undefined ? [] : [`#:schema ${schema}`];

  const table = (node: MapNode, path: string[], header: string | undefined, element: boolean) => {
    const values: string[] = [];
    const sections: Array<{ name: string; node: AuthoredNode; as: "table" | "tables" }> = [];
    for (const e of node.entries) {
      const as = section(e.key, e.value, path.length);
      if (as) sections.push({ name: e.key, node: e.value, as });
      else {
        const lead = `${key(e.key)} = `;
        values.push(lead + value(e.value, lead.length, 0, true, true));
      }
    }
    // A `[[…]]` header makes the element, so it is always written; a `[…]`
    // header with no values of its own is implied by its sub-tables.
    if (header !== undefined && (element || values.length > 0 || sections.length === 0)) {
      if (out.length > 0) out.push("");
      out.push(header);
    }
    out.push(...values);
    for (const s of sections) {
      const at = [...path, s.name];
      const dotted = at.map(key).join(".");
      if (s.as === "table") table(s.node as MapNode, at, `[${dotted}]`, false);
      else for (const item of (s.node as { items: MapNode[] }).items) table(item, at, `[[${dotted}]]`, true);
    }
  };

  table(root, [], undefined, false);
  return `${out.join("\n")}\n`;
}
