/**
 * @file Live documents: applying layer and source operations (0.10, ml-4ug, U2)
 * @module @maplibre-yaml/core/renderer/update
 *
 * @description
 * `applyOps(host, request)` drives a running map through the operations
 * the differ produced, reaching the map and the renderer's collaborators
 * only through the injected {@link UpdateHost} (KTD10). It owns the apply
 * order, existence reconciliation (KTD1), document-only reordering (KTD3),
 * end-of-diff source reference settlement (KTD4) and per-operation failure
 * handling on both channels (KTD7). It decides nothing from map state
 * beyond whether a layer exists; values come from the documents (R10).
 *
 * Apply order: named-source changes, layer removes, layer replacements and
 * adds in document position, property sets, the ordering pass, source
 * reference settlement, then named-source removals for sources nothing
 * draws any more. Structural adds and moves run last-to-first in document
 * order so every layer's anchor — the next document layer — is already on
 * the map when the layer is placed before it.
 *
 * Type-only imports: this module ships in the engine's lazy chunk, which
 * shares nothing with the main bundle.
 */

import type { Layer } from "../../schemas/layer.schema";
import type { MapErrorContext } from "../map-renderer";
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
 * Sort the operations into phases. Inline sources (`${layerId}-source`)
 * travel with their layer — `LayerManager` adds, replaces and removes them
 * as part of the layer — so their operations are not applied on their own.
 */
function partition(ops: readonly UpdateOp[]): Phases {
  const phases: Phases = { sourceChanges: [], removes: [], structural: [], properties: [], moves: [], sourceRemovals: [] };
  for (const op of ops) {
    switch (op.op) {
      case "sourceAdd":
      case "sourceReplace":
      case "sourceSetData":
      case "sourceSetUrl":
      case "sourceSetTiles":
        if (!op.inline) phases.sourceChanges.push(op);
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

/** Where a layer sits in the document, as the differ computes it (see `LayerPosition`). */
function positionOf(layers: readonly Layer[], index: number): LayerPosition {
  const anchor = (layers[index] as { before?: unknown }).before;
  const beforeId =
    typeof anchor === "string" && !layers.some((layer) => layer.id === anchor) ? anchor : layers[index + 1]?.id;
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
 * Run one operation; a throw becomes a recorded failure and a non-fatal
 * error report, and the update goes on (KTD7).
 */
async function attempt(
  host: UpdateHost,
  summary: UpdateSummary,
  op: UpdateOp,
  context: MapErrorContext,
  run: () => void | Promise<void>
): Promise<void> {
  try {
    await run();
  } catch (thrown) {
    const error = thrown instanceof Error ? thrown : new Error(String(thrown));
    summary.failures.push({ op: op.op, message: error.message });
    host.onError(error, context);
  }
}

const layerContext = (layerId: string): MapErrorContext => ({ kind: "layer", layerId });
const sourceContext = (sourceId: string): MapErrorContext => ({ kind: "source", sourceId });

/**
 * Named-source changes.
 *
 * @remarks
 * U3 fills this in: `sourceReplace`, `sourceSetData`, `sourceSetUrl` and
 * `sourceSetTiles` through the setters and loaders `LayerManager` gains
 * there (KTD4). Until then only `sourceAdd` applies, through the same
 * registration first render uses; the other operations are recorded in
 * the summary by the differ but change nothing on the map.
 */
async function applySourceChange(host: UpdateHost, op: SourceChangeOp): Promise<void> {
  if (op.op === "sourceAdd") {
    host.layerManager.registerSources({ [op.sourceId]: op.source });
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
 * Add or replace a document layer in document position. A layer id the map
 * already has that the document did not declare is a host's: the document
 * layer is refused with a hint and the host's is left alone (KTD1).
 */
async function placeLayer(host: UpdateHost, op: StructuralOp): Promise<void> {
  const { layerId, layer, position } = op;
  const owned = host.layerManager.ownsLayer(layerId);
  if (!owned && host.map.getLayer(layerId)) {
    throw new Error(
      `Layer "${layerId}" is already on the map but was not declared by the document ` +
        `(a host added it through addLayer or getMap().addLayer), so the document's layer is skipped. ` +
        `Give one of them another id.`
    );
  }
  const prepared = host.prepareLayer(layer);
  if (!prepared) return; // skipped with the renderer's own warning (a type below the runtime floor)
  if (owned) {
    // A replacement, or a document layer the host removed from the map:
    // through the same claim path as a fresh add (ml-aot.142).
    host.eventHandler.detachEvents(layerId);
    if (op.op === "layerReplace") host.emit("layer:removed", { layerId });
    await host.layerManager.replaceLayer(prepared, position.beforeId);
  } else {
    await host.layerManager.addLayer(prepared, position.beforeId);
  }
  host.eventHandler.attachEvents(prepared);
  host.emit("layer:added", { layerId });
}

/**
 * Set one changed layer key. Keys the renderer owns (`runtime`) belong to
 * the runtime re-sync (U4), except `interactive`, whose whole effect is
 * the layer's event bindings: those are re-bound here.
 */
function setProperty(host: UpdateHost, next: AppliedDocument, op: LayerSetPropertyOp): void {
  if (op.target === "runtime") {
    if (op.property !== "interactive") return;
    const layer = next.layers.find((entry) => entry.id === op.layerId);
    if (layer) host.eventHandler.reattachEvents(layer);
    return;
  }
  host.layerManager.setLayerProperty(op.layerId, op.target, op.property, op.value);
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
      await attempt(host, summary, op, sourceContext(op.sourceId), () => applySourceChange(host, op));
    }
    for (const op of phases.removes) {
      await attempt(host, summary, op, layerContext(op.layerId), () => removeLayer(host, op));
    }
    // Last to first: each layer goes before the next document layer, which is then already there.
    const structural = [...phases.structural].sort((a, b) => b.position.index - a.position.index);
    for (const op of structural) {
      await attempt(host, summary, op, layerContext(op.layerId), () => placeLayer(host, op));
    }
    for (const op of phases.properties) {
      await attempt(host, summary, op, layerContext(op.layerId), () => setProperty(host, next, op));
    }
    for (const op of [...phases.moves].reverse()) {
      await attempt(host, summary, op, layerContext(op.layerId), () => host.layerManager.moveLayer(op.layerId, op.beforeId));
    }
  } finally {
    host.layerManager.settleSources();
  }
  for (const op of phases.sourceRemovals) {
    await attempt(host, summary, op, sourceContext(op.sourceId), () => host.layerManager.removeSource(op.sourceId));
  }
  hintContradictedAnchors(host, next);
  return summary;
}
