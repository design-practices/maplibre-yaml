/**
 * @file A layer's `source:` that names no source (0.9.1, ml-aot.133)
 * @module @maplibre-yaml/core/parser/source-refs
 *
 * @description
 * `source: quakes` on a layer must name a source the map has. Before 0.9.1 a
 * name the document didn't define validated — it might have been one of the
 * basemap style's own sources — and the layer then failed on the page. A
 * mistyped name (or an inline source's `id:`, which names nothing) passed
 * `mlym validate` and `<ml-map>` validation alike.
 *
 * Now a name is an error at the layer's `source:` line, with a did-you-mean,
 * whenever validation can tell the layer has nothing to draw from:
 *
 * | The name is… | Result |
 * | --- | --- |
 * | defined in scope (see below), or a generated `<layer id>-source` | valid |
 * | a source of a basemap whose sources are known (an inline style object, or the Protomaps shorthand's `protomaps`) | valid |
 * | anything else, and the basemap's sources are known | error |
 * | anything else, on a circle/line/fill/symbol/heatmap/fill-extrusion layer with no `source-layer:` | error — a basemap's vector source needs `source-layer:` |
 * | anything else (a basemap URL could hold it: a raster layer, or one with `source-layer:`) | warning, only when it nearly names a defined source |
 *
 * Scope follows how documents nest: a block's `sources:` (v1 maps and
 * stories) or `style.sources:` (v2); in a multi-page root document, also the
 * root `sources:`. A root `layers:` record entry is pasted into blocks by
 * `$ref`, so any source the document defines anywhere is in its scope.
 */

import type { Document, LineCounter } from "yaml";
import { positionForPath, type ValidationWarning } from "./validation-utils";
import { suggest } from "../utils/suggest";
import { protomapsBasemapOf } from "../schemas/basemap.schema";
import { PROTOMAPS_SOURCE_ID } from "../formats/protomaps-style";

/** An error this check found (the parser's ParseError shape). */
export interface SourceRefError {
  path: string;
  message: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

type Obj = Record<string, unknown>;
type Path = (string | number)[];
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Layer types that draw features. Over a vector-tile source each needs a
 * `source-layer:`, so one without it can't be drawing from a basemap's
 * vector source: its `source:` must be a GeoJSON source the document has.
 */
const FEATURE_LAYER_TYPES: ReadonlySet<string> = new Set([
  "circle",
  "line",
  "fill",
  "symbol",
  "heatmap",
  "fill-extrusion",
]);

/** The basemap's source names, when the document says them; `undefined` for a style URL. */
type BasemapSources = ReadonlySet<string> | undefined;

function basemapSources(basemap: unknown): BasemapSources {
  if (protomapsBasemapOf(basemap)) return new Set([PROTOMAPS_SOURCE_ID]);
  if (isObject(basemap) && isObject(basemap["sources"])) return new Set(Object.keys(basemap["sources"]));
  return undefined;
}

interface Scope {
  /** Sources the document defines that this layer can reach. */
  defined: string[];
  /** Generated names of inline sources (`<layer id>-source`). */
  generated: string[];
  /**
   * Names an author may think an inline source has → the layer holding it:
   * the source's own `id:` (ignored), or the layer's id.
   */
  inlineIds: Map<string, { layer: string; via: "id" | "layer" }>;
  basemap: BasemapSources;
  /** Where definitions go, for the message: `sources:` or `style.sources:`. */
  home: string;
}

interface Context {
  errors: SourceRefError[];
  warnings: ValidationWarning[];
  positions?: { doc: Document; lineCounter: LineCounter };
}

function at(ctx: Context, path: Path): { line?: number; column?: number } {
  if (!ctx.positions) return {};
  const p = positionForPath(ctx.positions.doc, ctx.positions.lineCounter, path);
  return p ? { line: p.line, column: p.column } : {};
}

/** The generated names and `id:`s of a layer list's inline sources. */
function inlineSources(layers: unknown, scope: Scope): void {
  if (!Array.isArray(layers)) return;
  for (const layer of layers) {
    if (!isObject(layer) || !isObject(layer["source"]) || typeof layer["id"] !== "string") continue;
    scope.generated.push(`${layer["id"]}-source`);
    const id = layer["source"]["id"];
    if (typeof id === "string" && !scope.inlineIds.has(id)) {
      scope.inlineIds.set(id, { layer: layer["id"], via: "id" });
    }
    if (!scope.inlineIds.has(layer["id"])) scope.inlineIds.set(layer["id"], { layer: layer["id"], via: "layer" });
  }
}

function list(names: string[]): string {
  const shown = names.slice(0, 8).map((n) => `"${n}"`).join(", ");
  return names.length > 8 ? `${shown}, …` : shown;
}

function checkLayer(layer: unknown, path: Path, scope: Scope, ctx: Context): void {
  if (!isObject(layer)) return;
  const source = layer["source"];
  if (typeof source !== "string" || source === "") return;
  if (scope.defined.includes(source) || scope.generated.includes(source)) return;
  if (scope.basemap?.has(source)) return;

  const type = typeof layer["type"] === "string" ? layer["type"] : "";
  const hasSourceLayer = layer["source-layer"] !== undefined;
  const definite =
    scope.basemap !== undefined || (FEATURE_LAYER_TYPES.has(type) && !hasSourceLayer);
  const candidates = [...new Set([...scope.defined, ...scope.generated, ...(scope.basemap ?? [])])];
  const hint = suggest(source, candidates);
  const sourcePath = [...path, "source"];
  const name = typeof layer["id"] === "string" ? `Layer "${layer["id"]}"` : "This layer";

  if (!definite) {
    // A basemap style URL may well hold this name: only a near miss is
    // worth a word (the renderer reports a missing one on the page).
    if (!hint) return;
    ctx.warnings.push({
      path: sourcePath.join("."),
      message:
        `${name} uses source "${source}", which is not declared under ${scope.home}. ` +
        `Did you mean "${hint}"?`,
      ...at(ctx, sourcePath),
      suggestion: hint,
    });
    return;
  }

  const holder = scope.inlineIds.get(source);
  let message = `${name} uses source "${source}", which this document doesn't define.`;
  if (holder !== undefined) {
    message +=
      holder.via === "id"
        ? ` Layer "${holder.layer}" writes id: ${source} on its own inline source, but an inline ` +
          "source's id: doesn't name it."
        : ` "${source}" is a layer, and its source is written inline, so it has no name to use.`;
    message +=
      ` To share one source between layers, move it under ${scope.home} as ${source}: and write ` +
      `source: ${source} on each layer.`;
  } else {
    if (hint) message += ` Did you mean "${hint}"?`;
    message +=
      scope.defined.length > 0
        ? ` Sources defined here: ${list(scope.defined)}.`
        : ` This document defines no sources: add it under ${scope.home}.`;
    if (scope.basemap === undefined) {
      message +=
        " (To draw from one of the basemap style's own sources, the layer also needs source-layer:.)";
    }
  }
  ctx.errors.push({
    path: sourcePath.join("."),
    message,
    ...at(ctx, sourcePath),
    ...(hint && holder === undefined ? { suggestion: hint } : {}),
  });
}

/** Every source name defined anywhere in the document (for a root `layers:` record). */
function allDefined(node: unknown, out: Set<string>, depth = 0): void {
  if (depth > 12) return;
  if (Array.isArray(node)) {
    for (const item of node) allDefined(item, out, depth + 1);
    return;
  }
  if (!isObject(node)) return;
  if (isObject(node["sources"])) for (const k of Object.keys(node["sources"])) out.add(k);
  for (const [key, value] of Object.entries(node)) {
    if (key === "data" || key === "prefetchedData" || key === "properties" || key === "sources") continue;
    allDefined(value, out, depth + 1);
  }
}

function walk(node: unknown, path: Path, inherited: Scope, ctx: Context, rootAll?: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, [...path, i], inherited, ctx, rootAll));
    return;
  }
  if (!isObject(node)) return;

  // This node's scope: its own `sources:` (a v1 block, a story, the root),
  // or v2's `style:` (its sources, layers and basemap sit together there).
  const scope: Scope = {
    defined: [...inherited.defined],
    generated: [...inherited.generated],
    inlineIds: new Map(inherited.inlineIds),
    basemap: inherited.basemap,
    home: inherited.home,
  };
  if (isObject(node["sources"])) scope.defined.push(...Object.keys(node["sources"]));
  const config = node["config"];
  if (isObject(config)) {
    if (config["mapStyle"] !== undefined) scope.basemap = basemapSources(config["mapStyle"]);
    else if (config["defaultMapStyle"] !== undefined) scope.basemap = basemapSources(config["defaultMapStyle"]);
  }
  if (path[path.length - 1] === "style" && (Array.isArray(node["layers"]) || isObject(node["sources"]))) {
    if (node["basemap"] !== undefined) scope.basemap = basemapSources(node["basemap"]);
    scope.home = "style.sources:";
  }
  inlineSources(node["layers"], scope);

  for (const [key, value] of Object.entries(node)) {
    // Data payloads are never documents; skip the potentially huge walks.
    if (key === "data" || key === "prefetchedData" || key === "properties") continue;
    if (key === "layers") {
      if (Array.isArray(value)) {
        value.forEach((layer, i) => checkLayer(layer, [...path, key, i], scope, ctx));
      } else if (isObject(value) && rootAll) {
        // The multi-page root's reusable `layers:` record: each entry lands
        // in a block by `$ref`, so a source any block defines can serve it.
        const recordScope: Scope = { ...scope, defined: rootAll, basemap: undefined };
        for (const [name, layer] of Object.entries(value)) {
          checkLayer(layer, [...path, key, name], recordScope, ctx);
        }
      }
      continue;
    }
    if (key === "sources") continue;
    walk(value, [...path, key], scope, ctx, undefined);
  }
}

/**
 * Check every layer's `source:` name in a materialized document — a v1 or v2
 * map, a story, or a multi-page root document.
 *
 * @param positions - The YAML document, for line/column; omit for values
 *   that did not come from YAML text.
 */
export function checkLayerSources(
  value: unknown,
  positions?: { doc: Document; lineCounter: LineCounter }
): { errors: SourceRefError[]; warnings: ValidationWarning[] } {
  const ctx: Context = { errors: [], warnings: [], ...(positions ? { positions } : {}) };
  if (!isObject(value)) return { errors: ctx.errors, warnings: ctx.warnings };
  const isRoot = Array.isArray(value["pages"]);
  let rootAll: string[] | undefined;
  if (isRoot) {
    const names = new Set<string>();
    allDefined(value, names);
    rootAll = [...names];
  }
  walk(
    value,
    [],
    { defined: [], generated: [], inlineIds: new Map(), basemap: undefined, home: "sources:" },
    ctx,
    rootAll
  );
  return { errors: ctx.errors, warnings: ctx.warnings };
}
