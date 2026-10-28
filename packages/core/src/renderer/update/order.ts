/**
 * @file Live documents: the one document-order rule, for first render and updates (KTD3)
 * @module @maplibre-yaml/core/renderer/update
 *
 * @description
 * Which document layers to move, and before what, so the map shows them in
 * document order. A layer whose `before:` names a layer the document does
 * not declare (a basemap layer) is pinned there, out of the chain: it goes
 * before the next layer pinned to the same anchor, or the anchor itself.
 * Every other layer goes before the next unpinned document layer; the last
 * goes on top. So a pinned layer sits where the author put it, and the
 * layers around it in the document stay on top of the basemap. Minimal: the
 * longest run already in order is left alone, so `a, b, c` → `c, a, b`
 * moves only `c`. The differ runs it over the applied and next documents;
 * the renderer runs it once over the live style after first render, whose
 * parallel adds let a named-source layer land before inline-source ones.
 *
 * The moves come back in document order and are applied LAST TO FIRST, so
 * each layer's successor is already in place when the layer is moved before
 * it (`apply.ts` and `MapRenderer.orderDocumentLayers` both do).
 *
 * Pure over ids; type-only imports, as the chunk's import rule requires.
 */

import type { Layer } from "../../schemas/layer.schema";

/** One move: `layerId` goes before `beforeId`, or on top when absent. */
export interface LayerMove {
  layerId: string;
  beforeId?: string;
}

/** The layer outside the document a layer's `before:` pins it to, if any. */
function anchorOf(layers: readonly Layer[], index: number): string | undefined {
  const anchor = (layers[index] as { before?: unknown }).before;
  return typeof anchor === "string" && !layers.some((layer) => layer.id === anchor) ? anchor : undefined;
}

/**
 * The layer a document layer sits before: pinned (its `before:` names a
 * layer outside the document), the next layer pinned to the same anchor, or
 * the anchor; otherwise the next unpinned document layer, or nothing (the
 * top).
 */
export function beforeIdOf(layers: readonly Layer[], index: number): string | undefined {
  const anchor = anchorOf(layers, index);
  for (let next = index + 1; next < layers.length; next++) {
    if (anchorOf(layers, next) === anchor) return layers[next]!.id;
  }
  return anchor;
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
 * to top, other layers allowed in between) into document order: the
 * unpinned layers among themselves, and each pinned group below its anchor
 * (when the anchor is in `currentOrder`). Layers not in `currentOrder` are
 * skipped; `forced` layers move even when settled (an anchor that changed).
 * In document order; apply last to first.
 */
export function documentOrderMoves(
  layers: readonly Layer[],
  currentOrder: readonly string[],
  forced: ReadonlySet<string> = new Set()
): LayerMove[] {
  const rank = new Map(currentOrder.map((id, index) => [id, index]));
  // One chain per anchor (`undefined`: the unpinned layers), each ending at its anchor when the map has it.
  const chains = new Map<string | undefined, string[]>();
  layers.forEach((layer, index) => {
    if (!rank.has(layer.id)) return;
    const anchor = anchorOf(layers, index);
    if (!chains.has(anchor)) chains.set(anchor, []);
    chains.get(anchor)!.push(layer.id);
  });
  const settled = new Set<string>();
  const skipped = new Set<string>();
  for (const [anchor, ids] of chains) {
    if (anchor === undefined) {
      for (const id of settledIds(ids, rank)) settled.add(id);
    } else if (rank.has(anchor)) {
      for (const id of settledIds([...ids, anchor], rank)) settled.add(id);
    } else {
      for (const id of ids) skipped.add(id);
    }
  }
  const moves: LayerMove[] = [];
  layers.forEach((layer, index) => {
    if (!rank.has(layer.id)) return;
    if ((settled.has(layer.id) || skipped.has(layer.id)) && !forced.has(layer.id)) return;
    const beforeId = beforeIdOf(layers, index);
    moves.push(beforeId === undefined ? { layerId: layer.id } : { layerId: layer.id, beforeId });
  });
  return moves;
}
