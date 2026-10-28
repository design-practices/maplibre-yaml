/**
 * @file Live documents: applying layer and source operations (0.10, ml-4ug, U2/U3)
 * @module @maplibre-yaml/core/renderer/update
 *
 * @description
 * `applyOps(host, request)` drives a running map through the operations
 * the differ produced, reaching the map and the renderer's collaborators
 * only through the injected {@link UpdateHost} (KTD10). It owns the apply
 * order, existence reconciliation (KTD1), document-only reordering (KTD3),
 * in-place source changes through MapLibre's setters with a replacement
 * fallback when the running maplibre-gl lacks one (KTD4), end-of-diff
 * source reference settlement (KTD4) and per-operation failure handling on
 * both channels (KTD7). It decides nothing from map state beyond whether a
 * layer exists and whether a source instance has a setter; values come
 * from the documents (R10).
 *
 * Apply order: named-source changes, layer removes, layer replacements and
 * adds in document position, property sets, the ordering pass, source
 * reference settlement, then named-source removals for sources nothing
 * draws any more. Structural adds and moves run last-to-first in document
 * order so every layer's anchor — the next document layer — is already on
 * the map when the layer is placed before it.
 *
 * Type-only imports beside the chunk's own modules: this module ships in
 * the engine's lazy chunk, which shares nothing with the main bundle.
 */

import type { FeatureCollection } from "geojson";
import type { Layer } from "../../schemas/layer.schema";
import type {
  AppliedDocument,
  ApplyRequest,
  LayerAddOp,
  LayerMoveOp,
  LayerPosition,
  LayerRemoveOp,
  LayerReplaceOp,
  LayerSetPropertyOp,
  SourceAddOp,
  SourceRemoveOp,
  SourceReplaceOp,
  SourceSetDataOp,
  SourceSetTilesOp,
  SourceSetUrlOp,
  UpdateHost,
  UpdateOp,
  UpdateSummary,
} from "./types";
import { beforeIdOf } from "./order";
import { sourceIdOf } from "./compare";
import { contextOf, guard, hostLayerCollision, layerContext, sourceContext } from "./guard";

type StructuralOp = LayerAddOp | LayerReplaceOp;
type SourceChangeOp = SourceAddOp | SourceReplaceOp | SourceSetDataOp | SourceSetUrlOp | SourceSetTilesOp;

/** The operations of one update, by apply phase. */
interface Phases {
  sourceChanges: SourceChangeOp[];
  removes: LayerRemoveOp[];
  structural: StructuralOp[];
  properties: LayerSetPropertyOp[];
  moves: LayerMoveOp[];
  sourceRemovals: SourceRemoveOp[];
}

/**
 * Sort the operations into phases. An inline source (`${layerId}-source`)
 * is added, replaced and removed with its layer — `LayerManager` owns it as
 * part of the layer, and the differ pairs its `sourceReplace` with a
 * `layerReplace` — so only its in-place changes (`data`, `url`, `tiles`)
 * are applied on their own.
 */
function partition(ops: readonly UpdateOp[]): Phases {
  const phases: Phases = { sourceChanges: [], removes: [], structural: [], properties: [], moves: [], sourceRemovals: [] };
  for (const op of ops) {
    switch (op.op) {
      case "sourceAdd":
      case "sourceReplace":
        if (!op.inline) phases.sourceChanges.push(op);
        break;
      case "sourceSetData":
      case "sourceSetUrl":
      case "sourceSetTiles":
        phases.sourceChanges.push(op);
        break;
      case "sourceRemove":
        if (!op.inline) phases.sourceRemovals.push(op);
        break;
      case "layerRemove":
        phases.removes.push(op);
        break;
      case "layerAdd":
      case "layerReplace":
        phases.structural.push(op);
        break;
      case "layerSetProperty":
        phases.properties.push(op);
        break;
      case "layerMove":
        phases.moves.push(op);
        break;
      default:
        // Camera and option operations belong to the runtime re-sync (U4).
        break;
    }
  }
  return phases;
}

/** Where a layer sits in the document, as the differ computes it (the one rule in order.ts; see `LayerPosition`). */
function positionOf(layers: readonly Layer[], index: number): LayerPosition {
  const beforeId = beforeIdOf(layers, index);
  return beforeId === undefined ? { index } : { index, beforeId };
}

/**
 * Reconcile the next document against what the map has (KTD1): a document
 * layer the map lost — a host removed it through `getMap()` — is added
 * again in document position and listed under `added`. Its property sets
 * and moves are dropped: the re-add carries the next document's values.
 */
function reconcile(host: UpdateHost, next: AppliedDocument, phases: Phases, summary: UpdateSummary): void {
  const covered = new Set(phases.structural.map((op) => op.layerId));
  const reconciled = new Set<string>();
  next.layers.forEach((layer, index) => {
    if (covered.has(layer.id) || host.map.getLayer(layer.id)) return;
    phases.structural.push({ op: "layerAdd", layerId: layer.id, layer, position: positionOf(next.layers, index) });
    summary.added.push(layer.id);
    reconciled.add(layer.id);
  });
  if (reconciled.size === 0) return;
  phases.properties = phases.properties.filter((op) => !reconciled.has(op.layerId));
  phases.moves = phases.moves.filter((op) => !reconciled.has(op.layerId));
}

/**
 * Replace a source and every document layer over it in document position
 * (KTD4) when the source instance has no setter for the change: a named
 * source is rebuilt by `LayerManager` (refused, as a failure, while a host
 * layer draws it), an inline one is rebuilt with its layer. The dependent
 * layers' replacements join the structural phase, which has not run yet;
 * their own property sets and moves are dropped, as the replacement
 * carries the next document's values.
 */
function replaceSourceAndLayers(host: UpdateHost, request: ApplyRequest, phases: Phases, op: SourceChangeOp): void {
  const { next, summary } = request;
  if (!op.inline) host.layerManager.replaceSource(op.sourceId, op.source as Record<string, unknown>);
  // The differ listed its own `sourceReplace`; a setter fallback is news to the summary.
  if (op.op !== "sourceReplace") summary.sourcesReplaced.push(op.sourceId);
  const covered = new Set(phases.structural.map((entry) => entry.layerId));
  const replaced = new Set<string>();
  next.layers.forEach((layer, index) => {
    if (sourceIdOf(layer) !== op.sourceId || covered.has(layer.id)) return;
    phases.structural.push({ op: "layerReplace", layerId: layer.id, layer, position: positionOf(next.layers, index), reason: "source" });
    summary.replaced.push(layer.id);
    replaced.add(layer.id);
  });
  if (replaced.size === 0) return;
  phases.properties = phases.properties.filter((entry) => !replaced.has(entry.layerId));
  phases.moves = phases.moves.filter((entry) => !replaced.has(entry.layerId));
}

/**
 * Source changes (KTD4): a new named source registers as on first render; a
 * change without a setter rebuilds the source and its layers; `data`, `url`
 * and `tiles` go through `LayerManager`'s setters, which re-target the
 * source's live-data pipeline or reader alongside, and fall back to the
 * rebuild when the running maplibre-gl has no setter on this source.
 */
async function applySourceChange(host: UpdateHost, request: ApplyRequest, phases: Phases, op: SourceChangeOp): Promise<void> {
  const { layerManager } = host;
  switch (op.op) {
    case "sourceAdd":
      layerManager.registerSources({ [op.sourceId]: op.source });
      return;
    case "sourceReplace":
      replaceSourceAndLayers(host, request, phases, op);
      return;
    case "sourceSetData": {
      const data = (op.source as { data?: unknown }).data;
      if (data !== undefined && typeof data === "object") layerManager.setSourceData(op.sourceId, data as FeatureCollection);
      await layerManager.retargetPipeline(op.sourceId, op.source as Record<string, unknown>);
      // New features: a retained highlight id would light up whichever feature now holds it.
      for (const layer of request.next.layers) {
        if (sourceIdOf(layer) === op.sourceId && layerManager.ownsLayer(layer.id)) host.eventHandler.resetFeatureState(layer.id);
      }
      return;
    }
    case "sourceSetUrl":
      if (!(await layerManager.setSourceUrl(op.sourceId, op.source as Record<string, unknown>))) {
        replaceSourceAndLayers(host, request, phases, op);
      }
      return;
    case "sourceSetTiles":
      if (!layerManager.setSourceTiles(op.sourceId, op.source as Record<string, unknown>)) {
        replaceSourceAndLayers(host, request, phases, op);
      }
      return;
  }
}

/** Remove a document layer: events, pipelines, the layer and its inline source. Host layers are never touched. */
function removeLayer(host: UpdateHost, op: LayerRemoveOp): void {
  // Not ours: the layer never made it onto the map, or a host owns that id.
  if (!host.layerManager.ownsLayer(op.layerId)) return;
  host.eventHandler.detachEvents(op.layerId);
  host.layerManager.removeLayer(op.layerId);
  host.emit("layer:removed", { layerId: op.layerId });
}

/**
 * An update completes when its operations are applied, not when a layer's
 * `url:` has been read: the layer is placed with its source and the fetch
 * goes on as a generation-guarded task, as a named source's does (KTD5).
 * First render keeps awaiting the data for its `load` contract.
 */
const PLACE_ONLY = { awaitData: false } as const;

/**
 * Add or replace a document layer in document position. A layer id the map
 * already has that the document did not declare is a host's: the document
 * layer is refused with a hint and the host's is left alone (KTD1).
 */
async function placeLayer(host: UpdateHost, op: StructuralOp): Promise<void> {
  const { layerId, layer, position } = op;
  const owned = host.layerManager.ownsLayer(layerId);
  if (!owned && host.map.getLayer(layerId)) throw hostLayerCollision(layerId, "so the document's layer is skipped");
  const prepared = host.prepareLayer(layer);
  if (!prepared) return; // skipped with the renderer's own warning (a type below the runtime floor)
  if (owned) {
    // A replacement, or a document layer the host removed from the map:
    // through the same claim path as a fresh add (ml-aot.142).
    host.eventHandler.detachEvents(layerId);
    if (op.op === "layerReplace") host.emit("layer:removed", { layerId });
    await host.layerManager.replaceLayer(prepared, position.beforeId, PLACE_ONLY);
  } else {
    await host.layerManager.addLayer(prepared, position.beforeId, PLACE_ONLY);
  }
  host.eventHandler.attachEvents(prepared);
  host.emit("layer:added", { layerId });
}

/**
 * Set one changed layer key. Keys the renderer owns (`runtime`) belong to
 * the runtime re-sync (U4), except `interactive`, whose whole effect is
 * the layer's event bindings: those are re-bound here — never onto a host's
 * layer (KTD1): `LayerManager` refuses the setters for one, and the event
 * bindings are refused here the same way.
 */
function setProperty(host: UpdateHost, next: AppliedDocument, op: LayerSetPropertyOp): void {
  if (op.target === "runtime") {
    if (op.property !== "interactive") return;
    if (!host.layerManager.ownsLayer(op.layerId)) throw hostLayerCollision(op.layerId, "so its interactions are not bound to it");
    const layer = next.layers.find((entry) => entry.id === op.layerId);
    if (layer) host.eventHandler.reattachEvents(layer);
    return;
  }
  host.layerManager.setLayerProperty(op.layerId, op.target, op.property, op.value);
}

/**
 * The property sets aimed at a layer this document does not own on the map
 * — its id collided with a host's layer on an earlier update, so the map
 * has the host's and the document's was refused (KTD1). One failure per
 * such layer, not one per key, and none of its sets run.
 */
function dropForeignProperties(host: UpdateHost, summary: UpdateSummary, properties: LayerSetPropertyOp[]): LayerSetPropertyOp[] {
  const foreign = new Set(properties.map((op) => op.layerId).filter((layerId) => !host.layerManager.ownsLayer(layerId)));
  for (const layerId of foreign) {
    const error = hostLayerCollision(layerId, "so the document's changes to it are skipped");
    summary.failures.push({ op: "layerSetProperty", message: error.message, layerId });
    host.onError(error, contextOf(error, layerContext(layerId)));
  }
  return foreign.size === 0 ? properties : properties.filter((op) => !foreign.has(op.layerId));
}

/**
 * A `before:` that names an earlier document layer contradicts document
 * order, which wins (KTD3): say so once per layer and anchor, through the
 * same hint channel first render uses, never once per update.
 */
function hintContradictedAnchors(host: UpdateHost, next: AppliedDocument): void {
  const indexOf = new Map(next.layers.map((layer, index) => [layer.id, index]));
  next.layers.forEach((layer, index) => {
    const anchor = (layer as { before?: unknown }).before;
    if (typeof anchor !== "string") return;
    const at = indexOf.get(anchor);
    if (at === undefined || at >= index) return; // a basemap layer, or a later document layer: no contradiction
    host.layerManager.hintOnce(
      layer.id,
      anchor,
      `Layer \`${layer.id}\`: \`before: ${anchor}\` names a layer that comes earlier in the document, so document order is kept ` +
        `and the layer stays above \`${anchor}\`. Move \`${layer.id}\` above \`${anchor}\` under \`layers:\` to draw it there.`
    );
  });
}

/**
 * Apply the differ's operations to the running map through `host`.
 *
 * @remarks
 * Returns the request's summary with every failure appended and every
 * reconciled re-add listed under `added`. Named-source reference counts
 * settle after the whole diff (KTD4): a source two layers swap is never
 * torn down between them, and a source a host layer still draws stays, as
 * a recorded failure. Camera and option operations are left to the runtime
 * re-sync (U4).
 */
export async function applyOps(host: UpdateHost, request: ApplyRequest): Promise<UpdateSummary> {
  const { next, summary } = request;
  const phases = partition(request.ops);
  reconcile(host, next, phases, summary);

  host.layerManager.beginSourceSettlement();
  try {
    for (const op of phases.sourceChanges) {
      await guard(host, summary, op.op, () => applySourceChange(host, request, phases, op), sourceContext(op.sourceId));
    }
    for (const op of phases.removes) {
      await guard(host, summary, op.op, () => removeLayer(host, op), layerContext(op.layerId));
    }
    // Last to first: each layer goes before the next document layer, which is then already there.
    const structural = [...phases.structural].sort((a, b) => b.position.index - a.position.index);
    for (const op of structural) {
      await guard(host, summary, op.op, () => placeLayer(host, op), layerContext(op.layerId));
    }
    for (const op of dropForeignProperties(host, summary, phases.properties)) {
      await guard(host, summary, op.op, () => setProperty(host, next, op), layerContext(op.layerId));
    }
    for (const op of [...phases.moves].reverse()) {
      await guard(host, summary, op.op, () => host.layerManager.moveLayer(op.layerId, op.beforeId), layerContext(op.layerId));
    }
  } finally {
    host.layerManager.settleSources();
  }
  for (const op of phases.sourceRemovals) {
    await guard(host, summary, op.op, () => host.layerManager.removeSource(op.sourceId), sourceContext(op.sourceId));
  }
  hintContradictedAnchors(host, next);
  return summary;
}
