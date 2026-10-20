/**
 * @file Which GeoParquet columns a document reads (0.9, ml-cnv.4)
 * @module @maplibre-yaml/core/formats/columns
 *
 * @description
 * GeoParquet is columnar: a reader can fetch just the columns it needs, and
 * a wide file (dozens of attributes) costs a fraction of its size to draw.
 * By default core reads the geometry plus every property the document
 * references for that source, from every layer that draws from it:
 *
 * - expressions in `paint`, `layout` and `filter` — `["get", "x"]`,
 *   `["has", "x"]`, and legacy filters (`["==", "x", 1]`);
 * - `{x}` tokens in strings (`text-field: "{name}"`);
 * - popup, hover and legend content items (`property: x`);
 * - `classify:` `field` and `normalize` (as authored, or as the compiled
 *   record the renderer receives in the layer's metadata);
 * - the source's own `promoteId`, `filter` and `clusterProperties`;
 * - a story chapter's actions on a layer that draws from it — the filter of
 *   `setFilter`, the value of `setPaintProperty` / `setLayoutProperty` (see
 *   {@link storyColumns}).
 *
 * An expression that can read any property (`["properties"]`, or a `get`
 * whose key is computed) turns projection off for that source. An author's
 * `columns:` replaces the inference (`columns: all` reads everything) — the
 * escape hatch for page JavaScript that reads clicked features' other
 * properties.
 *
 * Pure (no DOM, no reader), so the renderer and `<ml-map>`'s `fitTo`
 * prefetch agree on one list.
 */

import { classifyRecordOf } from "../classify/compile";
import { declaredColumns, formatOfSource, typeReadsFormat } from "./detect";

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Every property, or a set of property names. */
type Found = { all: boolean; names: Set<string> };

/** Legacy (non-expression) filter operators whose second element is a property name. */
const LEGACY_KEY_OPS = new Set(["==", "!=", "<", "<=", ">", ">=", "in", "!in", "has", "!has"]);

/** `{name}` tokens in a string (MapLibre's legacy token syntax). */
function addTokens(text: string, found: Found): void {
  for (const m of text.matchAll(/\{([^{}\s]+)\}/g)) found.names.add(m[1]!);
}

/** Walk an expression (or anything that may contain one). */
function walk(value: unknown, found: Found): void {
  if (found.all) return;
  if (typeof value === "string") {
    addTokens(value, found);
    return;
  }
  if (Array.isArray(value)) {
    const [op, arg] = value;
    if (op === "properties") {
      found.all = true;
      return;
    }
    if ((op === "get" || op === "has") && value.length === 2) {
      if (typeof arg === "string") found.names.add(arg);
      else found.all = true; // a computed key could read any property
    }
    if (typeof op === "string" && LEGACY_KEY_OPS.has(op) && typeof arg === "string" && !arg.startsWith("$")) {
      // A legacy filter (`["==", "kind", "x"]`). In an expression the same
      // shape compares a literal, so the name is at worst an unused column.
      found.names.add(arg);
    }
    for (const item of value) walk(item, found);
    return;
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "property" && typeof item === "string") found.names.add(item);
      else if (key === "classify" && isObject(item)) {
        for (const k of ["field", "normalize"]) if (typeof item[k] === "string") found.names.add(item[k] as string);
        walk(item, found);
      } else walk(item, found);
    }
  }
}

/** The parts of a layer that can reference feature properties (not its id, type or source). */
function walkLayer(layer: Obj, found: Found): void {
  const { id: _id, type: _type, source: _source, "source-layer": _sl, metadata: _metadata, ...rest } = layer;
  walk(rest, found);
  // By the time a document reaches the renderer, `classify:` has been
  // compiled into a record in the layer's metadata (its paint is written at
  // runtime): read its field and divisor there.
  const record = classifyRecordOf(layer);
  if (record) {
    found.names.add(record.field);
    if (typeof record.normalize === "string") found.names.add(record.normalize);
  }
}

/** The parts of a source that reference properties: `promoteId`, `filter`, `clusterProperties`. */
function walkSource(source: Obj, found: Found): void {
  const runtime = isObject(source["runtime"]) ? source["runtime"] : {};
  const promoteId = source["promoteId"] ?? runtime["promoteId"];
  if (typeof promoteId === "string") found.names.add(promoteId);
  else if (isObject(promoteId)) for (const v of Object.values(promoteId)) if (typeof v === "string") found.names.add(v);
  walk(source["filter"], found);
  walk(source["clusterProperties"], found);
}

/** Keys of a chapter action that name things other than feature properties. */
const ACTION_NON_PROPERTY_KEYS = new Set(["action", "layer", "property", "bounds"]);

/**
 * The parts of a story chapter action that can reference feature
 * properties: `filter` (`setFilter`), `value` (`setPaintProperty` /
 * `setLayoutProperty`), and anything else it carries — not its `property`,
 * which names a paint or layout property, nor its layer or bounds.
 */
function walkAction(action: Obj, found: Found): void {
  for (const [key, value] of Object.entries(action)) {
    if (!ACTION_NON_PROPERTY_KEYS.has(key)) walk(value, found);
  }
}

/** Whether a source reads GeoParquet into a GeoJSON source. */
export function isGeoParquetSource(source: unknown): source is Obj {
  return isObject(source) && formatOfSource(source) === "geoparquet" && typeReadsFormat(source["type"], "geoparquet");
}

/**
 * The columns to read for each GeoParquet source in a document, by the id
 * the renderer gives the source: a named source's name, or
 * `<layer id>-source` for a source written inline on a layer.
 *
 * @param sources - The document's named `sources:` (v1 shape).
 * @param layers - The document's layers (v1 shape, runtime keys flat).
 * @param actions - Story chapter actions (`onChapterEnter` / `onChapterExit`
 *   items): each one counts for the source its `layer:` draws from.
 * @returns A list (geometry not included), or `all` for a source whose
 *   references can't be narrowed — or that the author set `columns: all` on.
 */
export function geoParquetColumns(
  sources: unknown,
  layers: unknown,
  actions: readonly unknown[] = []
): Map<string, readonly string[] | "all"> {
  const out = new Map<string, readonly string[] | "all">();
  const layerList = Array.isArray(layers) ? layers.filter(isObject) : [];
  const actionList = actions.filter(isObject);

  const resolve = (id: string, source: Obj, users: Obj[]) => {
    const declared = declaredColumns(source);
    if (declared !== undefined) {
      out.set(id, declared);
      return;
    }
    const found: Found = { all: false, names: new Set() };
    walkSource(source, found);
    for (const layer of users) walkLayer(layer, found);
    const ids = new Set(users.map((layer) => layer["id"]));
    for (const action of actionList) if (ids.has(action["layer"])) walkAction(action, found);
    out.set(id, found.all ? "all" : [...found.names].sort());
  };

  if (isObject(sources)) {
    for (const [name, source] of Object.entries(sources)) {
      if (!isGeoParquetSource(source)) continue;
      resolve(name, source, layerList.filter((layer) => layer["source"] === name));
    }
  }
  for (const layer of layerList) {
    const source = layer["source"];
    if (isGeoParquetSource(source) && typeof layer["id"] === "string") {
      resolve(`${layer["id"]}-source`, source, [layer]);
    }
  }
  return out;
}

/**
 * A story's map document with the GeoParquet columns its chapters also read
 * written onto the sources (0.9). A chapter's `setFilter` or
 * `setPaintProperty` runs long after the file was read, on the features
 * already loaded: a column only it names must be read up front. The map
 * itself sees only `sources:` and `layers:`, so the story resolves the list
 * — the layers' references plus its chapters' — and hands it over as the
 * source's `columns:`. Sources an author gave `columns:` keep them; a
 * document without GeoParquet sources or chapter actions comes back as is.
 *
 * @param doc - The story's map document (`storyMapDocument`), v1 shape.
 * @param actions - Every chapter's `onChapterEnter` and `onChapterExit` items.
 */
export function storyColumns(doc: Record<string, unknown>, actions: readonly unknown[]): Record<string, unknown> {
  if (actions.length === 0) return doc;
  const sources = isObject(doc["sources"]) ? doc["sources"] : undefined;
  const layers = Array.isArray(doc["layers"]) ? (doc["layers"] as unknown[]) : [];
  const withActions = geoParquetColumns(sources, layers, actions);
  if (withActions.size === 0) return doc;
  const without = geoParquetColumns(sources, layers);
  const same = (a: readonly string[] | "all" | undefined, b: readonly string[] | "all" | undefined) =>
    JSON.stringify(a) === JSON.stringify(b);

  let nextSources = sources;
  let nextLayers = layers;
  for (const [id, columns] of withActions) {
    if (same(columns, without.get(id))) continue;
    const named = sources?.[id];
    if (isGeoParquetSource(named)) {
      nextSources = { ...nextSources, [id]: { ...named, columns } };
      continue;
    }
    nextLayers = nextLayers.map((layer) =>
      isObject(layer) && `${String(layer["id"])}-source` === id && isGeoParquetSource(layer["source"])
        ? { ...layer, source: { ...layer["source"], columns } }
        : layer
    );
  }
  if (nextSources === sources && nextLayers === layers) return doc;
  return { ...doc, ...(nextSources ? { sources: nextSources } : {}), layers: nextLayers };
}
