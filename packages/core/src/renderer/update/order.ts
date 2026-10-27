/**
 * @file Live documents: the one document-order rule, for first render and updates (KTD3)
 * @module @maplibre-yaml/core/renderer/update
 *
 * @description
 * Which document layers to move, and before what, so the map shows them in
 * document order: each layer goes before the next document layer (or its
 * own `before:` when that names a layer the document does not declare — a
 * basemap layer); the last keeps its anchor or stays where it is. Minimal:
 * the longest run already in order is left alone, so `a, b, c` → `c, a, b`
 * moves only `c`. The differ runs it over the applied and next documents;
 * the renderer runs it once over the live style after first render, whose
 * parallel adds let a named-source layer land before inline-source ones.
 *
 * Pure over ids; type-only imports, as the chunk's import rule requires.
 */

import type { Layer } from "../../schemas/layer.schema";

/** One move: `layerId` goes before `beforeId`, or on top when absent. */
export interface LayerMove {
  layerId: string;
  beforeId?: string;
}

/** The layer a document layer sits before: the next document layer, or its own `before:` anchor outside the document. */
export function beforeIdOf(layers: readonly Layer[], index: number): string | undefined {
  const anchor = (layers[index] as { before?: unknown }).before;
  if (typeof anchor === "string" && !layers.some((layer) => layer.id === anchor)) return anchor;
  return layers[index + 1]?.id;
}

/** The longest run of `ids` (in document order) whose `rank` already ascends: these stay. */
function settledIds(ids: readonly string[], rank: ReadonlyMap<string, number>): Set<string> {
  const tails: number[] = [];
  const tailIds: string[][] = [];
  for (const id of ids) {
    const r = rank.get(id)!;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < r) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = r;
    tailIds[lo] = [...(tailIds[lo - 1] ?? []), id];
  }
  return new Set(tailIds[tails.length - 1] ?? []);
}

/**
 * The moves that put the document layers present in `currentOrder` (bottom
 * to top, other layers allowed in between) into document order. Layers not
 * in `currentOrder` are skipped; `forced` layers move even when settled (an
 * anchor that changed).
 */
export function documentOrderMoves(
  layers: readonly Layer[],
  currentOrder: readonly string[],
  forced: ReadonlySet<string> = new Set()
): LayerMove[] {
  const rank = new Map(currentOrder.map((id, index) => [id, index]));
  const present = layers.map((layer) => layer.id).filter((id) => rank.has(id));
  const settled = settledIds(present, rank);
  const moves: LayerMove[] = [];
  layers.forEach((layer, index) => {
    if (!rank.has(layer.id)) return;
    if (settled.has(layer.id) && !forced.has(layer.id)) return;
    const beforeId = beforeIdOf(layers, index);
    moves.push(beforeId === undefined ? { layerId: layer.id } : { layerId: layer.id, beforeId });
  });
  return moves;
}
