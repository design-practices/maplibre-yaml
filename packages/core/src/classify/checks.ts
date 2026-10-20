/**
 * @file `classify:` checks that need the layer around the block
 * @module @maplibre-yaml/core/classify/checks
 *
 * @description
 * The schema checks a `classify:` block on its own. These checks need its
 * layer and the document's sources, so the parser runs them after the
 * schema, on the materialized value, with the YAML document for positions:
 *
 * - the layer type has a colour to classify (not raster, heatmap …);
 * - `property:` is a colour paint property of that layer type;
 * - classify and an authored paint value do not both claim one property
 *   (one owner per property: classify, or a raw expression — never both);
 * - `radius:` only on circle layers;
 * - `noData: hide` / `other: hide` combine with an *expression* filter;
 * - `method:` only over a GeoJSON source read whole — a vector tile source,
 *   or a FlatGeobuf source read by view (`load: viewport` in any spelling),
 *   never gives the browser the whole dataset, so computed breaks would
 *   describe only the part in view. (A FlatGeobuf file too large to read
 *   whole switches to the by-view read at runtime; the classify runtime
 *   refuses computed breaks there — see renderer/classify-runtime.)
 *
 * The walk is shape-agnostic (v1 and v2 map blocks, stories, multi-page
 * documents): any object under a `layers` key that carries `classify` is a
 * classified layer, and the nearest enclosing `sources:` (or v2
 * `style.sources`) resolves its named source.
 */

import type { Document, LineCounter } from "yaml";
import { positionForKey, positionForPath, type ValidationWarning } from "../parser/validation-utils";
import { suggest } from "../utils/suggest";
import { loadModeOf } from "../formats/detect";
import { CLASSIFY_COLOR_PROPERTIES, defaultClassifyProperty } from "./compile";

/** A classify check failure (the parser's ParseError shape). */
export interface ClassifyCheckError {
  path: string;
  message: string;
  code: "schema";
  line?: number;
  column?: number;
  suggestion?: string;
}

type Path = (string | number)[];

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * MapLibre's own test for a filter in expression syntax (style-spec
 * `isExpressionFilter`), trimmed to what tells the two syntaxes apart. A
 * legacy filter (`["==", "name", "x"]`) cannot sit inside an expression
 * `all` with the no-data guard.
 */
export function isExpressionFilter(filter: unknown): boolean {
  if (filter === true || filter === false) return true;
  if (!Array.isArray(filter) || filter.length === 0) return false;
  switch (filter[0]) {
    case "has":
      return filter.length >= 2 && filter[1] !== "$id" && filter[1] !== "$type";
    case "in":
      return filter.length >= 3 && (typeof filter[1] !== "string" || Array.isArray(filter[2]));
    case "!in":
    case "!has":
    case "none":
      return false;
    case "==":
    case "!=":
    case ">":
    case ">=":
    case "<":
    case "<=":
      return filter.length !== 3 || Array.isArray(filter[1]) || Array.isArray(filter[2]);
    case "any":
    case "all":
      for (const f of filter.slice(1)) {
        if (!isExpressionFilter(f) && typeof f !== "boolean") return false;
      }
      return true;
    default:
      return true;
  }
}

/** Where a layer's source lives, as far as the document says. */
type SourceKind =
  | { kind: "geojson"; spec: Record<string, unknown> }
  | { kind: "other"; type: string }
  | { kind: "unknown"; name: string };

function resolveSource(
  source: unknown,
  sources: Record<string, unknown>,
  rootSources: Record<string, unknown>
): SourceKind {
  let spec: unknown = source;
  if (typeof source === "string") {
    spec = sources[source];
    if (spec === undefined) return { kind: "unknown", name: source };
  } else if (isObject(source) && typeof source["$ref"] === "string") {
    const name = String(source["$ref"]).replace(/^#\/sources\//, "");
    spec = rootSources[name] ?? sources[name];
    if (spec === undefined) return { kind: "unknown", name };
  }
  if (!isObject(spec)) return { kind: "unknown", name: String(source) };
  const type = spec["type"];
  if (type === "geojson") return { kind: "geojson", spec };
  return { kind: "other", type: typeof type === "string" ? type : "unknown" };
}

interface WalkContext {
  errors: ClassifyCheckError[];
  rootSources: Record<string, unknown>;
  pos?: { doc: Document; lineCounter: LineCounter };
}

function at(ctx: WalkContext, path: Path): { line?: number; column?: number } {
  if (!ctx.pos) return {};
  const p = positionForPath(ctx.pos.doc, ctx.pos.lineCounter, path);
  return p ? { line: p.line, column: p.column } : {};
}

function atKey(ctx: WalkContext, objectPath: Path, key: string): { line?: number; column?: number } {
  if (!ctx.pos) return {};
  const p = positionForKey(ctx.pos.doc, ctx.pos.lineCounter, objectPath, key);
  return p ? { line: p.line, column: p.column } : {};
}

function push(
  ctx: WalkContext,
  path: Path,
  message: string,
  where: { line?: number; column?: number },
  suggestion?: string
): void {
  ctx.errors.push({
    path: path.join("."),
    message,
    code: "schema",
    ...where,
    ...(suggestion ? { suggestion } : {}),
  });
}

function checkLayer(
  layer: Record<string, unknown>,
  path: Path,
  sources: Record<string, unknown>,
  ctx: WalkContext
): void {
  const classify = layer["classify"];
  if (!isObject(classify)) return;
  const cpath = [...path, "classify"];
  const type = typeof layer["type"] === "string" ? (layer["type"] as string) : "";
  const name = typeof layer["id"] === "string" ? `layer "${layer["id"]}"` : "this layer";
  const label = name.charAt(0).toUpperCase() + name.slice(1);

  // d3 and Vega call a palette a "scheme" (and the unknown-key warning has
  // no near spelling to offer), so name the key outright.
  if (classify["scheme"] !== undefined && classify["palette"] === undefined) {
    push(
      ctx,
      [...cpath, "scheme"],
      `classify names its colours with palette:, not scheme: — write palette: ${
        typeof classify["scheme"] === "string" ? classify["scheme"] : "Blues"
      }.`,
      atKey(ctx, cpath, "scheme"),
      "palette"
    );
  }

  const allowed = CLASSIFY_COLOR_PROPERTIES[type];
  if (!allowed) {
    push(
      ctx,
      cpath,
      `${label} is a ${type || "typeless"} layer, which has no per-feature colour for classify: to set. ` +
        "classify works on fill, line, circle, fill-extrusion and symbol layers.",
      atKey(ctx, path, "classify")
    );
    return;
  }

  const hasCategories = classify["categories"] !== undefined;
  const radius = classify["radius"];
  const classifiesColor =
    hasCategories ||
    classify["palette"] !== undefined ||
    classify["colors"] !== undefined ||
    radius === undefined;

  let target = defaultClassifyProperty(type)!;
  const property = classify["property"];
  if (typeof property === "string") {
    if (!allowed.includes(property)) {
      const hint = suggest(property, allowed, 4);
      push(
        ctx,
        [...cpath, "property"],
        `"${property}" is not a colour property classify can drive on a ${type} layer.` +
          (hint ? ` Did you mean "${hint}"?` : "") +
          ` Use ${allowed.map((p) => `"${p}"`).join(", ")}.`,
        at(ctx, [...cpath, "property"]),
        hint
      );
      return;
    }
    target = property;
  }

  const paint = isObject(layer["paint"]) ? layer["paint"] : {};
  const ppath = [...path, "paint"];
  if (classifiesColor && paint[target] !== undefined) {
    push(
      ctx,
      [...ppath, target],
      `${label} sets paint.${target} and also classify:, which writes ${target} from its classes. ` +
        `Keep one: remove paint.${target} to use classify, or remove classify: to keep your own ${target}.`,
      atKey(ctx, ppath, target)
    );
  }
  if (radius !== undefined) {
    if (type !== "circle") {
      push(
        ctx,
        [...cpath, "radius"],
        `radius: sizes circles (graduated symbols), and ${name} is a ${type} layer. ` +
          "Use it on a circle layer.",
        atKey(ctx, cpath, "radius")
      );
    } else if (paint["circle-radius"] !== undefined) {
      push(
        ctx,
        [...ppath, "circle-radius"],
        `${label} sets paint.circle-radius and also classify radius:, which writes circle-radius ` +
          "from its classes. Keep one.",
        atKey(ctx, ppath, "circle-radius")
      );
    }
  }

  // hide → the guard is ANDed onto the layer's filter, in expression syntax.
  const hides =
    (typeof classify["noData"] === "string" && classify["noData"].trim().toLowerCase() === "hide") ||
    (typeof classify["other"] === "string" && classify["other"].trim().toLowerCase() === "hide") ||
    (radius !== undefined &&
      classify["palette"] === undefined &&
      classify["colors"] === undefined &&
      classify["noData"] === undefined);
  const filter = layer["filter"];
  if (hides && filter !== undefined && !isExpressionFilter(filter)) {
    push(
      ctx,
      [...path, "filter"],
      `${label} hides some features with classify (noData: hide / other: hide), which adds a ` +
        "condition to the layer's filter: — and this filter is in MapLibre's legacy syntax, which " +
        'cannot be combined with it. Rewrite it as an expression, e.g. ["==", ["get", "kind"], "park"].',
      atKey(ctx, path, "filter")
    );
  }

  if (classify["method"] !== undefined) {
    const source = resolveSource(layer["source"], sources, ctx.rootSources);
    const mpath = [...cpath, "method"];
    const fix =
      " Write the class thresholds yourself with breaks: (for example computed in QGIS over the " +
      "full dataset): breaks: [10, 25, 50].";
    if (source.kind === "other") {
      push(
        ctx,
        mpath,
        `method: computes breaks from the whole dataset, and ${name} draws from a ` +
          `${source.type} source: the browser only ever sees the tiles in view, so breaks computed ` +
          "there would describe part of the data and change as you pan." +
          fix,
        atKey(ctx, cpath, "method")
      );
    } else if (source.kind === "unknown") {
      push(
        ctx,
        mpath,
        `method: computes breaks from the whole dataset, and ${name}'s source "${source.name}" ` +
          "is not a GeoJSON source declared in this document (a basemap's sources are vector " +
          "tiles), so there is no dataset to compute from." +
          fix,
        atKey(ctx, cpath, "method")
      );
    } else if (loadModeOf(source.spec).mode === "viewport") {
      // Every spelling of the by-view read: `load: viewport`, the object
      // form `{ mode: viewport }`, v2's `runtime.load`, an inline source.
      push(
        ctx,
        mpath,
        `method: computes breaks from the whole dataset, and ${name}'s source loads only the ` +
          "features in view (load: viewport), so breaks computed there would describe part of " +
          "the data and change as you pan. Use load: all, or write breaks: yourself.",
        atKey(ctx, cpath, "method")
      );
    }
  }
}

function walk(
  node: unknown,
  path: Path,
  sources: Record<string, unknown>,
  ctx: WalkContext,
  inLayers: boolean
): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, [...path, i], sources, ctx, inLayers));
    return;
  }
  if (!isObject(node)) return;

  if (inLayers && "classify" in node) {
    checkLayer(node, path, sources, ctx);
  }

  // The sources visible below this node: its own `sources:` (v1 blocks,
  // stories, the multi-page root) or v2's `style.sources`.
  let scope = sources;
  if (isObject(node["sources"])) scope = { ...sources, ...node["sources"] };
  if (isObject(node["style"]) && isObject((node["style"] as Record<string, unknown>)["sources"])) {
    scope = { ...scope, ...((node["style"] as Record<string, unknown>)["sources"] as Record<string, unknown>) };
  }

  for (const [key, value] of Object.entries(node)) {
    // Data payloads are never documents; skip the potentially huge walks.
    if (key === "data" || key === "prefetchedData" || key === "properties") continue;
    if (key === "layers") {
      if (Array.isArray(value)) {
        value.forEach((layer, i) => walk(layer, [...path, key, i], scope, ctx, true));
      } else if (isObject(value)) {
        // The multi-page root's reusable layer records.
        for (const [name, layer] of Object.entries(value)) {
          walk(layer, [...path, key, name], scope, ctx, true);
        }
      }
      continue;
    }
    walk(value, [...path, key], scope, ctx, false);
  }
}

/**
 * Check every classified layer in a materialized document.
 *
 * @param positions - The YAML document, for line/column; omit for values
 *   that did not come from YAML text.
 */
export function checkClassify(
  value: unknown,
  positions?: { doc: Document; lineCounter: LineCounter }
): ClassifyCheckError[] {
  const rootSources = isObject(value) && isObject(value["sources"]) ? value["sources"] : {};
  const ctx: WalkContext = { errors: [], rootSources, ...(positions ? { pos: positions } : {}) };
  walk(value, [], {}, ctx, false);
  return ctx.errors;
}

/** The ids of a layer list's classified layers that show their classes. */
function classifiedInLegend(layers: unknown): string[] {
  if (!Array.isArray(layers)) return [];
  const ids: string[] = [];
  for (const layer of layers) {
    if (!isObject(layer) || !isObject(layer["classify"])) continue;
    const runtime = isObject(layer["runtime"]) ? layer["runtime"] : {};
    const legend = layer["legend"] ?? runtime["legend"];
    if (legend === false || isObject(legend)) continue;
    ids.push(typeof layer["id"] === "string" ? layer["id"] : "?");
  }
  return ids;
}

/**
 * A legend block with its own `items:` beside a classified layer (ml-aot.94):
 * the hand-written items usually describe the colours the layer had before
 * `classify:`. The legend shows the items and then the generated classes; a
 * warning (and an on-page author hint) says so and what to change.
 *
 * Covers a v1 map or story (`legend:` beside `layers:`) and a v2 map
 * (`runtime.legend` beside `style.layers`).
 */
export function checkClassifiedLegendItems(
  value: unknown,
  positions?: { doc: Document; lineCounter: LineCounter }
): ValidationWarning[] {
  if (!isObject(value)) return [];
  const candidates: Array<{ legend: unknown; path: Path; layers: unknown }> = [
    { legend: value["legend"], path: ["legend"], layers: value["layers"] },
  ];
  const runtime = value["runtime"];
  const style = value["style"];
  if (isObject(runtime) && isObject(style)) {
    candidates.push({ legend: runtime["legend"], path: ["runtime", "legend"], layers: style["layers"] });
  }
  const warnings: ValidationWarning[] = [];
  for (const { legend, path, layers } of candidates) {
    if (!isObject(legend) || !Array.isArray(legend["items"]) || legend["items"].length === 0) continue;
    const ids = classifiedInLegend(layers);
    if (ids.length === 0) continue;
    const names = ids.map((id) => `"${id}"`).join(", ");
    const p = positions ? positionForKey(positions.doc, positions.lineCounter, path, "items") : undefined;
    warnings.push({
      path: [...path, "items"].join("."),
      message:
        `Layer${ids.length > 1 ? "s" : ""} ${names} ${ids.length > 1 ? "are" : "is"} classified, and the ` +
        "legend block also lists items written by hand. The legend shows those items first, then " +
        "the classes that classify generates. If the items describe the colours the layer had " +
        "before, remove them. To keep a layer's classes out of the legend, write legend: false " +
        "on that layer.",
      ...(p ? { line: p.line, column: p.column } : {}),
      onPage: true,
    });
  }
  return warnings;
}
