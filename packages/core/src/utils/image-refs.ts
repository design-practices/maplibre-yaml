/**
 * @file Which image names a document's layers ask for
 * @module @maplibre-yaml/core/utils/image-refs
 *
 * @description
 * MapLibre fires `styleimagemissing` for every layer on the map, the
 * basemap's included, without saying which layer asked. OpenFreeMap Liberty's
 * sprite lacks some POI icons (`office`, `running`, …), so a warning that
 * blamed the document for every miss pointed students at YAML they could not
 * fix (ml-aot.37). This collects the names the document's own layers can
 * produce, so the renderer can tell the two apart.
 */

/** Layout and paint properties whose values are image names. */
const IMAGE_PROPERTIES: ReadonlyArray<["layout" | "paint", string]> = [
  ["layout", "icon-image"],
  ["paint", "fill-pattern"],
  ["paint", "line-pattern"],
  ["paint", "fill-extrusion-pattern"],
  ["paint", "background-pattern"],
];

/** Expression operators whose result is a name built from data. */
const DATA_OPERATORS = new Set([
  "get",
  "properties",
  "feature-state",
  "to-string",
  "concat",
  "downcase",
  "upcase",
  "slice",
  "at",
  "global-state",
]);

/** The image names a document can ask for. */
export interface ImageRefs {
  /** Names written in the document (literals, and every branch of match/case/step/coalesce). */
  names: Set<string>;
  /** Whether some name is built from feature data, so any name could be the document's. */
  dynamic: boolean;
}

export function createImageRefs(): ImageRefs {
  return { names: new Set(), dynamic: false };
}

/** Add the image names one layer can produce to `refs`. */
export function noteLayerImageRefs(refs: ImageRefs, layer: unknown): void {
  if (!layer || typeof layer !== "object") return;
  const l = layer as Record<string, unknown>;
  for (const [group, key] of IMAGE_PROPERTIES) {
    const props = l[group];
    if (props && typeof props === "object") {
      const value = (props as Record<string, unknown>)[key];
      if (value !== undefined) collectOutputs(value, refs);
    }
  }
}

/** Walk the values an image property can evaluate to. */
function collectOutputs(value: unknown, refs: ImageRefs): void {
  if (typeof value === "string") {
    refs.names.add(value);
    return;
  }
  if (!Array.isArray(value) || value.length === 0) return;
  const [op, ...args] = value as [unknown, ...unknown[]];
  if (typeof op !== "string") return;
  if (DATA_OPERATORS.has(op)) {
    refs.dynamic = true;
    return;
  }
  switch (op) {
    case "literal":
      if (typeof args[0] === "string") refs.names.add(args[0]);
      return;
    case "image":
      collectOutputs(args[0], refs);
      return;
    case "match": {
      // ["match", input, label, out, label, out, …, fallback]
      for (let i = 2; i < value.length; i += 2) {
        collectOutputs(value[i === value.length - 1 ? i : i + 1], refs);
      }
      return;
    }
    case "case": {
      // ["case", cond, out, cond, out, …, fallback]
      for (let i = 2; i < value.length; i += 2) collectOutputs(value[i], refs);
      collectOutputs(value[value.length - 1], refs);
      return;
    }
    case "step": {
      // ["step", input, out0, stop, out, …]
      for (let i = 2; i < value.length; i += 2) collectOutputs(value[i], refs);
      return;
    }
    case "coalesce":
      for (const arg of args) collectOutputs(arg, refs);
      return;
    default:
      // Anything else could pass a name through: count every string in it.
      for (const arg of args) collectOutputs(arg, refs);
  }
}
