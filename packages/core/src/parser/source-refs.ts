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
 *
 * ## `$ref` (0.9.1, ml-aot.147)
 *
 * `source: { $ref: "#/sources/quakes" }` and a layer entry
 * `- $ref: "#/layers/shared"` are resolved when the document is read (see
 * `YAMLParser.resolveReferences`, and `<ml-map>` for a story's map), always
 * against the document's top-level `sources:` / `layers:` record. A `$ref`
 * that resolves nowhere used to pass `mlym validate` for a story (and failed
 * a map or root document without a line number) while `<ml-map>` showed an
 * error card. It is now an error at the `$ref` line, worded as the runtime
 * words it ({@link refNotFoundMessage}), so validation and the page agree.
 * v2 documents don't resolve `$ref` (their schema rejects one), so they are
 * not checked here. A reference written as a string (`source:
 * "#/sources/quakes"`) is never resolved, so it is an error on any layer.
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
  /** What a `$ref` resolves against: the document's top-level records. */
  refs: { sources: unknown; layers: unknown; root: boolean };
}

/**
 * The message for a `$ref` that names nothing — shared with
 * `YAMLParser.resolveReferences`, so `mlym validate` and `<ml-map>`'s error
 * card say the same thing.
 */
export function refNotFoundMessage(ref: string, section: "layers" | "sources", record: unknown): string {
  const name = ref.slice(`#/${section}/`.length);
  // A standalone block's `layers:` is a list, not a record: its indices are
  // nothing to suggest.
  const defined = isObject(record) ? Object.keys(record) : [];
  const hint = suggest(name, defined);
  const what = section === "layers" ? "Layer" : "Source";
  return (
    `${what} reference not found: ${ref}.` +
    (hint ? ` Did you mean "#/${section}/${hint}"?` : "") +
    (defined.length
      ? ` Defined ${section}: ${defined.join(", ")}.`
      : ` No ${section} are defined at the root level.`)
  );
}

const REF = /^#\/(layers|sources)\/(.+)$/;

/** Whether `name` is an entry of a `$ref` target record (the runtime's own test). */
function inRecord(record: unknown, name: string): boolean {
  return (isObject(record) || Array.isArray(record)) && name in record;
}

/**
 * A `$ref` where a layer (`want: "layers"`) or a layer's source
 * (`want: "sources"`) goes: it must have the right form and name an entry of
 * the top-level record, or reading the document fails.
 */
function checkRef(
  ref: string,
  want: "layers" | "sources",
  refPath: Path,
  scope: Scope,
  ctx: Context
): void {
  const match = REF.exec(ref);
  if (!match || match[1] !== want) {
    const message = !match
      ? `Invalid reference format: ${ref}. Expected #/${want}/name.`
      : want === "sources"
        ? `A layer's source: $ref must point at a source (#/sources/name), not ${ref}.`
        : `A layers: entry's $ref must point at a layer (#/layers/name), not ${ref}.`;
    ctx.errors.push({ path: refPath.join("."), message, ...at(ctx, refPath) });
    return;
  }
  const name = match[2]!;
  const record = want === "sources" ? ctx.refs.sources : ctx.refs.layers;
  if (inRecord(record, name)) return;

  let message = refNotFoundMessage(ref, want, record);
  const hint = suggest(name, isObject(record) ? Object.keys(record) : []);
  if (want === "sources" && ctx.refs.root && scope.defined.includes(name)) {
    // A block's own source: a $ref looks only at the root sources: record.
    message +=
      ` "${name}" is defined in this block's sources:, which a $ref doesn't look in:` +
      ` write source: ${name} instead.`;
  } else if (want === "layers" && !ctx.refs.root) {
    message +=
      " A layer $ref names an entry of the root layers: record, which only a multi-page" +
      " (pages:) document has: write the layer here instead.";
  }
  ctx.errors.push({
    path: refPath.join("."),
    message,
    ...at(ctx, refPath),
    ...(hint ? { suggestion: `#/${want}/${hint}` } : {}),
  });
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
  // v2 (`style.layers`) doesn't resolve `$ref`: its schema reports one.
  const resolvesRefs = scope.home !== "style.sources:";
  // Any object with a string `$ref` is replaced whole, as the runtime does.
  if (resolvesRefs && typeof layer["$ref"] === "string") {
    checkRef(layer["$ref"], "layers", [...path, "$ref"], scope, ctx);
    return;
  }
  const source = layer["source"];
  if (resolvesRefs && isObject(source) && typeof source["$ref"] === "string") {
    checkRef(source["$ref"], "sources", [...path, "source", "$ref"], scope, ctx);
    return;
  }
  if (typeof source !== "string" || source === "") return;
  if (scope.defined.includes(source) || scope.generated.includes(source)) return;
  if (scope.basemap?.has(source)) return;

  // `source: "#/sources/quakes"`: a reference written as a plain string is
  // never resolved, and no basemap names a source like that — an error even
  // where an ordinary name might be the basemap's (a raster layer).
  const asRef = /^#\/sources\/(.+)$/.exec(source);
  if (asRef) {
    const name = asRef[1]!;
    const objectForm = resolvesRefs && inRecord(ctx.refs.sources, name);
    const bare = scope.defined.includes(name);
    const fix = objectForm
      ? `source: { $ref: "${source}" }${bare ? ` or source: ${name}` : ""}`
      : bare
        ? `source: ${name}`
        : `source: ${name} (once ${name} is defined under ${scope.home})`;
    const sourcePath = [...path, "source"];
    ctx.errors.push({
      path: sourcePath.join("."),
      message:
        `${typeof layer["id"] === "string" ? `Layer "${layer["id"]}"` : "This layer"} writes a ` +
        `reference as a plain string, source: "${source}", which is never resolved. Write ${fix}.`,
      ...at(ctx, sourcePath),
    });
    return;
  }

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
  if (!isObject(value)) return { errors: [], warnings: [] };
  const isRoot = Array.isArray(value["pages"]);
  const ctx: Context = {
    errors: [],
    warnings: [],
    ...(positions ? { positions } : {}),
    refs: { sources: value["sources"], layers: value["layers"], root: isRoot },
  };
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
