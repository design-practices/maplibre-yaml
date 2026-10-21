/**
 * @file Keep the authored order of a `categories:` map with numeric keys
 * @module @maplibre-yaml/core/classify/category-order
 *
 * @description
 * A JavaScript object lists integer-like keys first, in ascending order, so
 * `categories: { 10: red, 2: green, b: blue, 1: black }` reached the legend as
 * 1, 2, 10, b (ml-aot.80). The YAML document still has the order the author
 * wrote; after validation, each such map is rewritten into the equivalent
 * list form — `categories: [10, 2, b, 1]` with `colors: [red, green, blue,
 * black]` — which keeps it. The compiled `match` and the record are the same
 * either way; only the order (the legend's) changes.
 */

import { isMap, isScalar, visit, type Document } from "yaml";

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** A categories map as written: keys and colours, in document order. */
type Authored = Array<[string, unknown]>;

/** Order-free identity of a categories map: its entries, sorted. */
function signature(entries: Array<[string, unknown]>): string {
  return JSON.stringify([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Every `categories:` map in the YAML whose JS key order would differ. */
function authoredMaps(doc: Document): Map<string, Authored[]> {
  const found = new Map<string, Authored[]>();
  visit(doc, {
    Pair(_, pair) {
      if (!isScalar(pair.key) || pair.key.value !== "categories" || !isMap(pair.value)) return;
      const entries: Authored = [];
      for (const item of pair.value.items) {
        if (!isScalar(item.key)) return;
        const value = isScalar(item.value) ? item.value.value : undefined;
        entries.push([String(item.key.value), value]);
      }
      const jsOrder = Object.keys(Object.fromEntries(entries));
      if (jsOrder.every((key, i) => key === entries[i]![0])) return;
      const key = signature(entries);
      found.set(key, [...(found.get(key) ?? []), entries]);
    },
  });
  return found;
}

/**
 * Rewrite, in place, every classify `categories:` map of a validated
 * document whose numeric keys JavaScript would reorder into the list form
 * in the authored order. Documents without one are untouched.
 */
export function restoreCategoryOrder(data: unknown, doc: Document): void {
  const maps = authoredMaps(doc);
  if (maps.size === 0) return;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!isObject(node)) return;
    const categories = node["categories"];
    if (typeof node["field"] === "string" && isObject(categories) && node["colors"] === undefined) {
      const entries = Object.entries(categories);
      const queue = maps.get(signature(entries));
      const authored = queue?.shift();
      if (authored) {
        node["categories"] = authored.map(([value]) => value);
        node["colors"] = authored.map(([value]) => categories[value]);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "data" || key === "prefetchedData") continue;
      walk(value);
    }
  };
  walk(data);
}
