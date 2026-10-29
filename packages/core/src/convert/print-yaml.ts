/**
 * @file Print an authored tree as YAML
 * @module @maplibre-yaml/core/convert/print-yaml
 *
 * @description
 * Block mappings and block sequences of mappings, the way the guides write
 * documents. A list holding no mapping (an expression, a coordinate pair)
 * is a flow sequence, on one line when it fits in 80 columns, else one item
 * per line. Multi-line text is a literal block (`|`).
 *
 * A string is left unquoted only when every YAML reader reads it back as
 * the same string: YAML 1.1 readers (PyYAML among them) turn `on`, `no`,
 * `yes`, `2024-01-02` and `0755` into booleans, dates and numbers, so those
 * are quoted, as is anything starting with a digit. The schema hint becomes
 * a `# yaml-language-server: $schema=…` modeline; `{"$html": …}` becomes
 * `!html "…"`.
 *
 * Part of the lazy `convert` chunk: core is imported for types only.
 */

import type { AuthoredNode } from "./types";
import { WIDTH, fillLines } from "./wrap";

type NumberNode = Extract<AuthoredNode, { kind: "number" }>;

/** A finite number as JSON, YAML and TOML all write it; a whole number written as a float keeps its `.0`. */
export function numberText(node: NumberNode): string {
  const text = String(node.value);
  return node.float && /^-?\d+$/.test(text) ? `${text}.0` : text;
}

/** A non-finite number's name: `nan`, `inf` or `-inf`, as TOML and the loss messages write it (YAML adds a `.`). */
export function nonFiniteLabel(value: number): string {
  return Number.isNaN(value) ? "nan" : value > 0 ? "inf" : "-inf";
}

const pad = (n: number) => " ".repeat(n);

/**
 * Scalars a YAML 1.1 or 1.2 reader would read as something other than this
 * string: numbers, dates, times, octal and sexagesimal (anything starting
 * with a digit, or a sign or dot then a digit), `.inf`/`.nan`, the 1.1
 * booleans, null, the merge key and `=`.
 */
function retyped(s: string): boolean {
  return (
    /^[-+.]?\d/.test(s) ||
    /^[-+]?\.(?:inf|nan)$/i.test(s) ||
    /^(?:y|n|yes|no|true|false|on|off|null|~)$/i.test(s) ||
    s === "<<" ||
    s === "=" ||
    s.startsWith("...")
  );
}

/** Whether `s` can be written plain (unquoted) and read back as the same string. */
function plain(s: string, flow: boolean): boolean {
  if (s === "" || s !== s.trim()) return false;
  // eslint-disable-next-line no-control-regex -- control characters cannot be written as a plain YAML scalar
  if (/[\x00-\x1f\x7f-\x9f\u2028\u2029\ufeff]/.test(s)) return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s)) return false;
  if (/:(?:\s|$)|\s#/.test(s)) return false;
  if (flow && /[,[\]{}]/.test(s)) return false;
  return !retyped(s);
}

/** A double-quoted YAML string. JSON's escapes are YAML's; a few characters YAML wants escaped JSON leaves raw. */
function quoted(s: string): string {
  return JSON.stringify(s).replace(
    /[\x7f-\x9f\u2028\u2029\ufeff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

function scalar(node: AuthoredNode, flow: boolean): string {
  switch (node.kind) {
    case "string":
      return plain(node.value, flow) ? node.value : quoted(node.value);
    case "number":
      // `.nan`, `.inf`, `-.inf`.
      return Number.isFinite(node.value) ? numberText(node) : nonFiniteLabel(node.value).replace(/^-?/, "$&.");
    case "boolean":
      return String(node.value);
    case "null":
      return "null";
    case "html":
      return `!html ${quoted(node.value)}`;
    default:
      return flowText(node);
  }
}

const key = (k: string, flow = false) => (plain(k, flow) && !k.includes(":") ? k : quoted(k));

/** A list that prints as a flow sequence: it holds no mapping, at any depth. */
function flowable(node: AuthoredNode): boolean {
  return node.kind === "seq" && node.items.every((item) => item.kind !== "map" && (item.kind !== "seq" || flowable(item)));
}

/** Flow text. Strings in it are always quoted, so an expression reads as it does in the guides and in JSON. */
function flowText(node: AuthoredNode): string {
  if (node.kind === "seq") return `[${node.items.map(flowText).join(", ")}]`;
  if (node.kind === "map") {
    return node.entries.length === 0
      ? "{}"
      : `{ ${node.entries.map((e) => `${key(e.key, true)}: ${flowText(e.value)}`).join(", ")} }`;
  }
  return node.kind === "string" ? quoted(node.value) : scalar(node, true);
}

/** A flow sequence after `lead`, wrapped one item per line (items at `indent + 2`) when it does not fit. */
function flowLines(node: AuthoredNode, indent: number, lead: string): string[] {
  const one = flowText(node);
  if (node.kind !== "seq" || lead.length + one.length <= WIDTH || node.items.length === 0) return [lead + one];
  // As many items to a line as fit; an item too long for a line of its own wraps by itself.
  const inner = indent + 2;
  const groups = fillLines(node.items, inner, flowText).map((line) =>
    typeof line === "string"
      ? [pad(inner) + line]
      : line.item.kind === "seq"
        ? flowLines(line.item, inner, pad(inner))
        : [pad(inner) + line.text]
  );
  groups.forEach((group, i) => {
    if (i < groups.length - 1) group[group.length - 1] += ",";
  });
  return [`${lead}[`, ...groups.flat(), `${pad(indent)}]`];
}

/** Multi-line text that a literal block scalar holds exactly. */
function literal(s: string): boolean {
  if (!s.includes("\n") || s.trim() === "") return false;
  // eslint-disable-next-line no-control-regex -- control characters cannot be held by a YAML literal block
  if (/[\r\x00-\x08\x0b-\x1f\x7f-\x9f\u2028\u2029\ufeff]/.test(s)) return false;
  // Indentation is read from the first line with text; whitespace-only lines confuse it.
  if (/^[ \t]+$/m.test(s) || /^[ \t]/.test(s.replace(/^\n+/, ""))) return false;
  return true;
}

function literalLines(s: string, indent: number, lead: string): string[] {
  const trailing = /\n*$/.exec(s)![0].length;
  const chomp = trailing === 0 ? "-" : trailing === 1 ? "" : "+";
  const body = s.slice(0, s.length - trailing).split("\n").map((line) => (line === "" ? "" : pad(indent) + line));
  return [`${lead} |${chomp}`, ...body, ...Array<string>(Math.max(0, trailing - 1)).fill("")];
}

/** A value after `lead` (`key:` or `-`), its nested lines at `indent + 2`. */
function valueLines(node: AuthoredNode, indent: number, lead: string): string[] {
  switch (node.kind) {
    case "map":
      return node.entries.length === 0 ? [`${lead} {}`] : [lead, ...mapLines(node, indent + 2)];
    case "seq":
      if (node.items.length === 0) return [`${lead} []`];
      return flowable(node) ? flowLines(node, indent, `${lead} `) : [lead, ...seqLines(node, indent + 2)];
    case "string":
      return literal(node.value) ? literalLines(node.value, indent + 2, lead) : [`${lead} ${scalar(node, false)}`];
    default:
      return [`${lead} ${scalar(node, false)}`];
  }
}

function mapLines(node: Extract<AuthoredNode, { kind: "map" }>, indent: number): string[] {
  return node.entries.flatMap((e) => valueLines(e.value, indent, `${pad(indent)}${key(e.key)}:`));
}

/** A block sequence's lines at `indent`: a mapping or nested list starts on its `- ` line. */
function seqLines(node: Extract<AuthoredNode, { kind: "seq" }>, indent: number): string[] {
  return node.items.flatMap((item) => {
    if (item.kind === "map" && item.entries.length > 0) {
      const inner = mapLines(item, indent + 2);
      return [`${pad(indent)}- ${inner[0]!.slice(indent + 2)}`, ...inner.slice(1)];
    }
    if (item.kind === "seq" && item.items.length > 0 && !flowable(item)) {
      const inner = seqLines(item, indent + 2);
      return [`${pad(indent)}- ${inner[0]!.slice(indent + 2)}`, ...inner.slice(1)];
    }
    if (item.kind === "seq" && item.items.length > 0) return flowLines(item, indent + 2, `${pad(indent)}- `);
    return valueLines(item, indent, `${pad(indent)}-`);
  });
}

/**
 * Whether a schema hint can be written as a one-line comment: one token, no
 * whitespace or control character. tree.ts lifts only such a hint; this is
 * the second check, so a line break can never reach a comment line.
 */
export const commentableHint = (schema: string | undefined): schema is string =>
  // eslint-disable-next-line no-control-regex -- a hint with a control character must never reach a comment line
  schema !== undefined && /^[^\s\x00-\x1f\x7f-\x9f]+$/.test(schema);

/** The document as YAML text, ending in a newline. */
export function printYaml(root: AuthoredNode, schema: string | undefined): string {
  const head = commentableHint(schema) ? [`# yaml-language-server: $schema=${schema}`] : [];
  const body =
    root.kind === "map" && root.entries.length > 0
      ? mapLines(root, 0)
      : root.kind === "seq" && root.items.length > 0 && !flowable(root)
        ? seqLines(root, 0)
        : root.kind === "seq"
          ? flowLines(root, 0, "")
          : [scalar(root, false)];
  return `${[...head, ...body].join("\n")}\n`;
}
