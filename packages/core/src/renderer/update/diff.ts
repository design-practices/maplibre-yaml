/**
 * @file Live documents: the pure differ (0.10, ml-4ug)
 * @module @maplibre-yaml/core/renderer/update
 *
 * @description
 * `diff(applied, next, hints)` compares two normalized documents and returns
 * the ordered operations that turn the first into the second on a running
 * map, plus a summary derived from those operations. It reads no map state:
 * identity is the id (KTD2), host layers are whatever the document did not
 * declare, and the only knowledge beyond the documents arrives as
 * {@link DiffHints} (KTD1, KTD11).
 *
 * Pure over data: this module imports nothing but types, so it can ship in
 * the engine's lazy chunk (KTD10) and is tested without MapLibre.
 *
 * Replacement rules follow the plan's table (docs/plans/2026-10-27-001-feat-
 * live-documents-plan.md, "Changes that force a layer or source replacement").
 */

import type { MapConfig, FitToConfig } from "../../schemas/map.schema";
import type { Layer } from "../../schemas/layer.schema";
import type { LayerSource } from "../../schemas/source.schema";
import type {
  AppliedDocument,
  CameraValues,
  DiffHints,
  DiffResult,
  LayerPosition,
  LayerPropertyTarget,
  OptionKey,
  UpdateOp,
  UpdateSummary,
} from "./types";
import { beforeIdOf, documentOrderMoves } from "./order";

type Obj = Record<string, unknown>;

const CAMERA_KEYS = ["center", "zoom", "bearing", "pitch"] as const;

/** `config:` keys with a MapLibre setter: applied in place as `optionSet` (KTD7). */
const SETTABLE_CONFIG_KEYS = new Set<string>(["minZoom", "maxZoom", "maxBounds"]);

/** Option blocks compared whole, each its own `optionSet`. */
const OPTION_BLOCKS: readonly OptionKey[] = [
  "projection",
  "terrain",
  "sky",
  "light",
  "title",
  "description",
  "controls",
  "legend",
  "parameters",
  "markers",
  "popups",
  "images",
  "state",
];

/** Layer keys MapLibre can set on a live layer, by setter. */
const LAYER_PROPERTY_TARGETS: Record<string, LayerPropertyTarget> = {
  paint: "paint",
  layout: "layout",
  filter: "filter",
  minzoom: "zoom",
  maxzoom: "zoom",
  visible: "visibility",
};

/** Layer keys the differ handles elsewhere, never as a property set. */
const LAYER_STRUCTURAL_KEYS = new Set<string>(["id", "type", "source", "source-layer", "before", "effect"]);

/** Tile-backed source types: `tiles` / `url` have setters, the rest is constructor-only. */
const TILE_SOURCE_TYPES = new Set<string>(["vector", "raster", "raster-dem"]);

/**
 * Source keys that drive the library's pipeline, not MapLibre's source
 * (`SOURCE_RUNTIME_KEYS` in model/normalize.ts, minus `format`, which names
 * the source's kind): a change re-targets the pipeline in place.
 */
const SOURCE_PIPELINE_KEYS = new Set<string>([
  "refresh",
  "stream",
  "cache",
  "loading",
  "prefetchedData",
  "fetchStrategy",
  "refreshInterval",
  "updateStrategy",
  "updateKey",
  "load",
  "columns",
  "colorRamp",
]);

/** GeoJSON keys with a setter path (`setData`, the fetch path). */
const GEOJSON_SETTABLE_KEYS = new Set<string>(["data", "url"]);

/** Image and video keys with a setter path. */
const MEDIA_SETTABLE_KEYS = new Set<string>(["url", "urls"]);

/** A document source with the layers that draw it. */
interface SourceNode {
  source: LayerSource;
  inline: boolean;
  layerIds: string[];
}

type SourceGraph = Map<string, SourceNode>;

function jsonKey(value: unknown): string | undefined {
  return JSON.stringify(value);
}

function same(a: unknown, b: unknown): boolean {
  return jsonKey(a) === jsonKey(b);
}

function asObject(value: unknown): Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : {};
}

/** Keys present in either object whose values differ, in first-seen order. */
function changedKeys(a: Obj, b: Obj): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => !same(a[key], b[key]));
}

function hintsEmpty(hints: DiffHints): boolean {
  return hints.failedSources.size === 0 && !hints.urlsRebased;
}

function isBackground(layer: Layer): boolean {
  return layer.type === "background";
}

/** The id of the source a layer draws: its named source, or its own inline one. */
function sourceIdOf(layer: Layer): string | undefined {
  if (isBackground(layer)) return undefined;
  return typeof layer.source === "string" ? layer.source : `${layer.id}-source`;
}

function hasHoverHighlight(layer: Layer): boolean {
  const interactive = (layer as { interactive?: { hover?: { highlight?: unknown } } }).interactive;
  return interactive?.hover?.highlight === true;
}

/** Every source the document draws from, inline ones under `${layerId}-source`. */
function sourceGraph(doc: AppliedDocument): SourceGraph {
  const graph: SourceGraph = new Map();
  for (const [id, source] of Object.entries(doc.sources)) {
    graph.set(id, { source, inline: false, layerIds: [] });
  }
  for (const layer of doc.layers) {
    const id = sourceIdOf(layer);
    if (!id) continue;
    if (typeof layer.source !== "string") {
      graph.set(id, { source: layer.source as LayerSource, inline: true, layerIds: [] });
    }
    graph.get(id)?.layerIds.push(layer.id);
  }
  return graph;
}

/**
 * The feature-id strategy MapLibre is given for a GeoJSON source: the
 * author's `generateId` / `promoteId`, else `generateId: true` when a layer
 * over it uses `hover.highlight` (the 0.9.1 rule in layer-manager.ts).
 */
function effectiveIds(node: SourceNode, layers: readonly Layer[]): { generateId?: unknown; promoteId?: unknown } {
  const spec = asObject(node.source);
  const needsIds = layers.some((layer) => node.layerIds.includes(layer.id) && hasHoverHighlight(layer));
  const generateId =
    spec["generateId"] !== undefined || spec["promoteId"] !== undefined
      ? spec["generateId"]
      : needsIds
        ? true
        : undefined;
  return { generateId, promoteId: spec["promoteId"] };
}

function sourceKind(source: LayerSource): string {
  const spec = asObject(source);
  return `${String(spec["type"])}:${String(spec["format"] ?? "")}`;
}

function bearsUrl(source: LayerSource): boolean {
  const spec = asObject(source);
  return typeof spec["url"] === "string" || Array.isArray(spec["urls"]);
}

function bearsTiles(source: LayerSource): boolean {
  return Array.isArray(asObject(source)["tiles"]);
}

/** Whether a changed source key has a setter on this source type. */
function isSettableSourceKey(type: string, key: string): boolean {
  if (SOURCE_PIPELINE_KEYS.has(key)) return true;
  if (type === "geojson") return GEOJSON_SETTABLE_KEYS.has(key);
  if (TILE_SOURCE_TYPES.has(type)) return key === "tiles" || key === "url";
  return MEDIA_SETTABLE_KEYS.has(key);
}

/** The in-place operation for a source whose changed keys all have setters. */
function inPlaceSourceOp(changed: readonly string[], source: LayerSource): "sourceSetTiles" | "sourceSetUrl" | "sourceSetData" {
  if (changed.includes("tiles")) return "sourceSetTiles";
  if (changed.includes("url") || changed.includes("urls")) return "sourceSetUrl";
  if (changed.includes("data")) return "sourceSetData";
  // Only pipeline keys changed: re-target whatever the source reads.
  if (bearsTiles(source)) return "sourceSetTiles";
  return bearsUrl(source) ? "sourceSetUrl" : "sourceSetData";
}

/** Why a source present in both documents must be replaced, if it must. */
function sourceReplaceReason(
  before: SourceNode,
  after: SourceNode,
  appliedLayers: readonly Layer[],
  nextLayers: readonly Layer[]
): string | undefined {
  if (sourceKind(before.source) !== sourceKind(after.source)) return "kind";
  const type = String(asObject(after.source)["type"]);
  const changed = changedKeys(asObject(before.source), asObject(after.source));
  const constructorOnly = changed.find((key) => !isSettableSourceKey(type, key));
  if (constructorOnly) return constructorOnly;
  // The author's keys are unchanged; the hover rule may still flip `generateId`.
  if (type === "geojson" && !same(effectiveIds(before, appliedLayers), effectiveIds(after, nextLayers))) {
    return "generateId";
  }
  return undefined;
}

/** One operation per source the hints mark as changed, when the diff found none. */
function hintedSourceOp(id: string, node: SourceNode, hints: DiffHints): UpdateOp | undefined {
  const base = { sourceId: id, source: node.source, inline: node.inline };
  if (hints.failedSources.has(id)) {
    return bearsUrl(node.source) ? { op: "sourceSetUrl", ...base } : { op: "sourceReplace", reason: "failed", ...base };
  }
  if (hints.urlsRebased) {
    if (bearsTiles(node.source)) return { op: "sourceSetTiles", ...base };
    if (bearsUrl(node.source)) return { op: "sourceSetUrl", ...base };
  }
  return undefined;
}

/** Source adds, replacements and in-place changes; `replaced` collects the replaced ids. */
function sourceOps(applied: AppliedDocument, next: AppliedDocument, hints: DiffHints, replaced: Set<string>): UpdateOp[] {
  const before = sourceGraph(applied);
  const after = sourceGraph(next);
  const ops: UpdateOp[] = [];
  for (const [id, node] of after) {
    const base = { sourceId: id, source: node.source, inline: node.inline };
    const previous = before.get(id);
    if (!previous) {
      ops.push({ op: "sourceAdd", ...base });
      continue;
    }
    const reason = sourceReplaceReason(previous, node, applied.layers, next.layers);
    if (reason) {
      replaced.add(id);
      ops.push({ op: "sourceReplace", reason, ...base });
      continue;
    }
    const changed = changedKeys(asObject(previous.source), asObject(node.source));
    if (changed.length > 0) {
      ops.push({ op: inPlaceSourceOp(changed, node.source), ...base });
      continue;
    }
    const hinted = hintedSourceOp(id, node, hints);
    if (hinted) {
      if (hinted.op === "sourceReplace") replaced.add(id);
      ops.push(hinted);
    }
  }
  return ops;
}

function sourceRemovals(applied: AppliedDocument, next: AppliedDocument): UpdateOp[] {
  const after = sourceGraph(next);
  const ops: UpdateOp[] = [];
  for (const [id, node] of sourceGraph(applied)) {
    if (!after.has(id)) ops.push({ op: "sourceRemove", sourceId: id, inline: node.inline });
  }
  return ops;
}

/** Where a layer sits in the next document (see {@link LayerPosition}). */
function positionOf(layers: readonly Layer[], index: number): LayerPosition {
  const beforeId = beforeIdOf(layers, index);
  return beforeId === undefined ? { index } : { index, beforeId };
}

/** Why a layer present in both documents must be replaced, if it must. */
function layerReplaceReason(before: Layer, after: Layer, replacedSources: ReadonlySet<string>): string | undefined {
  if (before.type !== after.type) return "type";
  const sourceId = sourceIdOf(after);
  if (sourceId !== undefined && replacedSources.has(sourceId)) return "source";
  if (sourceIdOf(before) !== sourceId) return "source";
  if (!same((before as Obj)["source-layer"], (after as Obj)["source-layer"])) return "source-layer";
  // Toggling the highlight rewires the layer's paint; the add path does that.
  if (hasHoverHighlight(before) !== hasHoverHighlight(after)) return "interactive";
  return undefined;
}

/** The property sets that turn one layer into the next, when nothing forces a replacement. */
function layerPropertyOps(before: Layer, after: Layer): UpdateOp[] {
  const ops: UpdateOp[] = [];
  for (const key of changedKeys(before as Obj, after as Obj)) {
    if (LAYER_STRUCTURAL_KEYS.has(key)) continue;
    const target = LAYER_PROPERTY_TARGETS[key] ?? "runtime";
    if (target === "paint" || target === "layout") {
      for (const property of changedKeys(asObject((before as Obj)[key]), asObject((after as Obj)[key]))) {
        ops.push({ op: "layerSetProperty", layerId: after.id, target, property, value: asObject((after as Obj)[key])[property] });
      }
    } else if (target === "visibility") {
      ops.push({ op: "layerSetProperty", layerId: after.id, target, property: "visibility", value: after.visible === false ? "none" : "visible" });
    } else {
      ops.push({ op: "layerSetProperty", layerId: after.id, target, property: key, value: (after as Obj)[key] });
    }
  }
  return ops;
}

/** Layer removes, replacements, adds, property sets and moves, in apply order. */
function layerOps(applied: AppliedDocument, next: AppliedDocument, replacedSources: ReadonlySet<string>): UpdateOp[] {
  const before = new Map(applied.layers.map((layer, index) => [layer.id, { layer, index }]));
  const nextIds = new Set(next.layers.map((layer) => layer.id));
  const removes: UpdateOp[] = applied.layers
    .filter((layer) => !nextIds.has(layer.id))
    .map((layer) => ({ op: "layerRemove", layerId: layer.id }));
  const structural: UpdateOp[] = [];
  const properties: UpdateOp[] = [];
  const kept: string[] = [];
  const anchorChanged = new Set<string>();
  next.layers.forEach((layer, index) => {
    const previous = before.get(layer.id);
    if (!previous) {
      structural.push({ op: "layerAdd", layerId: layer.id, layer, position: positionOf(next.layers, index) });
      return;
    }
    const reason = layerReplaceReason(previous.layer, layer, replacedSources);
    if (reason) {
      structural.push({ op: "layerReplace", layerId: layer.id, layer, position: positionOf(next.layers, index), reason });
      return;
    }
    kept.push(layer.id);
    properties.push(...layerPropertyOps(previous.layer, layer));
    if (!same((previous.layer as Obj)["before"], (layer as Obj)["before"])) anchorChanged.add(layer.id);
  });
  // The kept layers in applied order are the map's order of them (KTD1: the
  // map is never read); the shared rule says which must move (KTD3).
  const keptInAppliedOrder = [...kept].sort((a, b) => before.get(a)!.index - before.get(b)!.index);
  const moves: UpdateOp[] = documentOrderMoves(next.layers, keptInAppliedOrder, anchorChanged).map((move) => ({ op: "layerMove", ...move }));
  return [...removes, ...structural, ...properties, ...moves];
}

function fitToOf(config: MapConfig): FitToConfig | undefined {
  const fitTo = (config as { fitTo?: FitToConfig | string }).fitTo;
  return typeof fitTo === "string" ? { source: fitTo } : fitTo;
}

/** The camera keys the next document owns and changed, and a `fitTo` added or re-targeted (KTD13). */
function cameraOps(applied: MapConfig, next: MapConfig): UpdateOp[] {
  const ops: UpdateOp[] = [];
  const camera: CameraValues = {};
  for (const key of CAMERA_KEYS) {
    const value = (next as Obj)[key];
    if (value !== undefined && !same((applied as Obj)[key], value)) (camera as Obj)[key] = value;
  }
  if (Object.keys(camera).length > 0) ops.push({ op: "cameraSet", camera });
  const fitTo = fitToOf(next);
  if (fitTo && !same(fitToOf(applied), fitTo)) ops.push({ op: "fitTo", fitTo });
  return ops;
}

/** The `effect:` blocks by layer id: the effects re-attach input (KTD6b). */
function effectsOf(doc: AppliedDocument): Record<string, unknown> {
  const effects: Record<string, unknown> = {};
  for (const layer of doc.layers) {
    const effect = (layer as { effect?: unknown }).effect;
    if (effect !== undefined) effects[layer.id] = effect;
  }
  return effects;
}

function optionOps(applied: AppliedDocument, next: AppliedDocument): UpdateOp[] {
  const ops: UpdateOp[] = [];
  const push = (option: OptionKey, before: unknown, after: unknown) => {
    if (!same(before, after)) ops.push({ op: "optionSet", option, value: after });
  };
  for (const key of SETTABLE_CONFIG_KEYS) push(key as OptionKey, (applied.config as Obj)[key], (next.config as Obj)[key]);
  for (const key of OPTION_BLOCKS) push(key, (applied.options as Obj)[key], (next.options as Obj)[key]);
  push("effects", effectsOf(applied), effectsOf(next));
  return ops;
}

/**
 * The `config:` key that forces a rebuild (KTD7): `mapStyle`, or any Map
 * constructor option without a setter. Camera keys, `fitTo` and the settable
 * options are applied in place.
 */
function fallbackReason(applied: MapConfig, next: MapConfig): string | undefined {
  const changed = changedKeys(applied as Obj, next as Obj).filter(
    (key) => !(CAMERA_KEYS as readonly string[]).includes(key) && key !== "fitTo" && !SETTABLE_CONFIG_KEYS.has(key)
  );
  return changed.includes("mapStyle") ? "mapStyle" : changed[0];
}

/** The summary is a reading of the operation list, never of what applying it did. */
function summarize(ops: readonly UpdateOp[]): UpdateSummary {
  const summary: UpdateSummary = {
    added: [],
    removed: [],
    moved: [],
    replaced: [],
    propertiesSet: [],
    sourcesReplaced: [],
    cameraMoved: false,
    rebuild: false,
    failures: [],
  };
  for (const op of ops) {
    switch (op.op) {
      case "layerAdd":
        summary.added.push(op.layerId);
        break;
      case "layerRemove":
        summary.removed.push(op.layerId);
        break;
      case "layerMove":
        summary.moved.push(op.layerId);
        break;
      case "layerReplace":
        summary.replaced.push(op.layerId);
        break;
      case "layerSetProperty":
        summary.propertiesSet.push({ layerId: op.layerId, property: op.property });
        break;
      case "sourceReplace":
        summary.sourcesReplaced.push(op.sourceId);
        break;
      case "cameraSet":
      case "fitTo":
        summary.cameraMoved = true;
        break;
      case "fallback":
        summary.rebuild = true;
        break;
      default:
        break;
    }
  }
  return summary;
}

function result(ops: UpdateOp[]): DiffResult {
  return { changed: ops.length > 0, ops, summary: summarize(ops) };
}

/**
 * The operations that turn `applied` into `next` on a running map.
 *
 * @remarks
 * Equal documents short-circuit only when `hints` is empty: `reload()` and a
 * `base` change pass hints, so an unchanged document still retries failed
 * sources (KTD11). A fallback is decided first and is the only operation
 * (KTD7). Otherwise the list is in apply order: source adds and changes,
 * layer removes, replacements and adds in document position, property sets,
 * moves, source removals, camera, then option blocks.
 */
export function diff(applied: AppliedDocument, next: AppliedDocument, hints: DiffHints): DiffResult {
  if (hintsEmpty(hints) && same(applied, next)) return result([]);
  const fallback = fallbackReason(applied.config, next.config);
  if (fallback) return result([{ op: "fallback", reason: fallback }]);
  const replacedSources = new Set<string>();
  return result([
    ...sourceOps(applied, next, hints, replacedSources),
    ...layerOps(applied, next, replacedSources),
    ...sourceRemovals(applied, next),
    ...cameraOps(applied.config, next.config),
    ...optionOps(applied, next),
  ]);
}
