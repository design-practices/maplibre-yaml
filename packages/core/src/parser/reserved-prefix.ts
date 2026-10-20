/**
 * @file The reserved leading `=` in style values (ml-3e9, v2 plan R15)
 * @module @maplibre-yaml/core/parser/reserved-prefix
 *
 * @description
 * A string value that starts with `=` is reserved for a future expression
 * shorthand (the formula-bar model: `"=upper({name})"`). Until that grammar
 * exists such a string means nothing special — MapLibre draws it as plain
 * text, or rejects it as a colour — and it would change meaning the day the
 * shorthand ships. So it warns now, at its line, in v1 and v2, on the console
 * and in `mlym validate`, and as an author hint on the page.
 *
 * **Where.** Style-value positions, where a MapLibre expression could go:
 * the values under a layer's `paint:` and `layout:`, its `filter:`, and a
 * story chapter's `setPaintProperty` / `setLayoutProperty` value. Prose
 * (titles, descriptions, popup text) is never checked.
 *
 * **Not expressions' own strings.** The first element of an array is an
 * expression operator, and MapLibre has one that starts with `=`: `==`.
 * `["==", ["get", "kind"], "park"]` and the legacy `["==", "kind", "park"]`
 * filter never warn.
 *
 * **The escape: `["literal", "=…"]`.** Text that really starts with `=` is
 * written as a MapLibre literal expression, which never warns and draws the
 * text as written. (The v2 plan's R16 proposed doubling the `=` instead; it
 * is not adopted: `==` is MapLibre's equality operator, so a doubled `=`
 * reads as one in every expression array, and doubling would need an
 * unescape pass in every consumer — the renderer, `mlym emit`, other tools
 * reading the YAML — while a literal expression is already MapLibre's own
 * way of saying "this string is data".)
 */

import type { Document, LineCounter } from "yaml";
import { positionForPath, type ValidationWarning } from "./validation-utils";

/** Keys whose values are style values (expression positions). */
const STYLE_VALUE_KEYS = new Set(["paint", "layout"]);

/** Story actions whose `value` is handed to MapLibre as a style value. */
const STYLE_VALUE_ACTIONS = new Set(["setPaintProperty", "setLayoutProperty"]);

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Whether a string uses the reserved prefix. */
export function hasReservedPrefix(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("=");
}

/**
 * A MapLibre expression a reserved string probably meant, for the message:
 * `"=upper({name})"` → `["upcase", ["get", "name"]]`.
 */
export function expressionExample(value: string): string {
  const property = /\{([^{}\s]+)\}/.exec(value)?.[1] ?? /\b(?:get|prop)\(\s*["']?([\w.-]+)/i.exec(value)?.[1];
  const get = `["get", "${property ?? "name"}"]`;
  if (/^=\s*(?:upper|upcase|uppercase)\s*\(/i.test(value)) return `["upcase", ${get}]`;
  if (/^=\s*(?:lower|downcase|lowercase)\s*\(/i.test(value)) return `["downcase", ${get}]`;
  return get;
}

/** The warning text for one reserved string. */
export function reservedPrefixMessage(value: string): string {
  const shown = value.length > 60 ? `${value.slice(0, 57)}…` : value;
  return (
    `Strings starting with "=" are reserved for a future expression shorthand, so ` +
    `"${shown}" is not a formula today: MapLibre gets the text as written. Write a ` +
    `MapLibre expression instead, e.g. ${expressionExample(value)}. (For text that ` +
    `really starts with "=", write ["literal", "${shown}"].)`
  );
}

/**
 * Every reserved string inside one style value.
 *
 * @param head - `value` is the first element of an array (an operator).
 */
function scanStyleValue(
  value: unknown,
  path: (string | number)[],
  out: Array<{ path: (string | number)[]; value: string }>,
  head = false
): void {
  if (typeof value === "string") {
    if (!head && hasReservedPrefix(value)) out.push({ path, value });
    return;
  }
  if (Array.isArray(value)) {
    // ["literal", …] is the escape: its contents are data, never checked.
    if (value[0] === "literal") return;
    value.forEach((item, index) => scanStyleValue(item, [...path, index], out, index === 0));
    return;
  }
  if (isObject(value)) {
    // A legacy function ({ property, stops }) or an object literal.
    for (const [key, item] of Object.entries(value)) scanStyleValue(item, [...path, key], out);
  }
}

/** Walk the whole document for style-value positions. */
function walk(
  node: unknown,
  path: (string | number)[],
  out: Array<{ path: (string | number)[]; value: string }>,
  depth: number
): void {
  if (depth > 64) return;
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, [...path, index], out, depth + 1));
    return;
  }
  if (!isObject(node)) return;
  const action = node["action"];
  const isStyleAction = typeof action === "string" && STYLE_VALUE_ACTIONS.has(action);
  for (const [key, value] of Object.entries(node)) {
    if (STYLE_VALUE_KEYS.has(key) && isObject(value)) {
      for (const [property, propertyValue] of Object.entries(value)) {
        scanStyleValue(propertyValue, [...path, key, property], out);
      }
    } else if (key === "filter") {
      scanStyleValue(value, [...path, key], out);
    } else if (key === "value" && isStyleAction) {
      scanStyleValue(value, [...path, key], out);
    } else {
      walk(value, [...path, key], out, depth + 1);
    }
  }
}

/**
 * Warnings for strings that start with the reserved `=` in style values.
 *
 * @param value - The materialized document (any block type, v1 or v2).
 * @param positions - The YAML document and line counter, for line numbers.
 */
export function reservedPrefixWarnings(
  value: unknown,
  positions?: { doc: Document; lineCounter: LineCounter }
): ValidationWarning[] {
  const found: Array<{ path: (string | number)[]; value: string }> = [];
  walk(value, [], found, 0);
  return found.map(({ path, value: text }) => {
    const pos = positions ? positionForPath(positions.doc, positions.lineCounter, path) : undefined;
    return {
      path: path.join("."),
      message: reservedPrefixMessage(text),
      ...(pos ? { line: pos.line, column: pos.column } : {}),
      onPage: true,
    };
  });
}
