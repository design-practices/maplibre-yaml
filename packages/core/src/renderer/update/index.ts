/**
 * @file Live documents: the update engine's chunk entry (0.10, ml-4ug, U4)
 * @module @maplibre-yaml/core/renderer/update
 *
 * @description
 * What `MapRenderer.update` loads on demand through the seam
 * (formats/decoders.ts, `getDecoder("update")`) and calls once per update:
 * the pure differ, the layer and source apply step and the runtime re-sync,
 * in that order, over the {@link UpdateHost} the renderer builds (KTD10).
 * Fallback was decided in the entry before this chunk was awaited (KTD7);
 * a `fallback` operation here means the differ disagreed, and nothing is
 * applied either way.
 *
 * Type-only imports beside `./diff`, `./apply` and `./resync`, which the
 * build bundles into this one file: the chunk shares nothing with the main
 * bundle, and never imports `emitter/` or `export/`.
 */

import { diff } from "./diff";
import { applyOps } from "./apply";
import { preloadImages, resync } from "./resync";
import type { UpdateHost, UpdateRequest, UpdateSummary } from "./types";

/** What the engine tells the renderer: whether anything changed, and what it did. */
export interface EngineResult {
  /** `false` when the documents were equal under empty hints: no operations, no event (KTD1). */
  changed: boolean;
  summary: UpdateSummary;
}

/**
 * Turn the applied document into the next one on the running map.
 *
 * @remarks
 * Images the next document newly references register first, so a layer
 * placed by the apply step finds its `icon-image` on its first frame; the
 * runtime features and the camera follow the operations (resync.ts).
 */
export async function runUpdate(host: UpdateHost, request: UpdateRequest): Promise<EngineResult> {
  const { applied, next, hints } = request;
  const result = diff(applied, next, hints);
  const { summary } = result;
  if (!result.changed || summary.rebuild) return { changed: result.changed, summary };
  await preloadImages(host, request, summary);
  await applyOps(host, { applied, next, ops: result.ops, summary });
  await resync(host, request, result.ops, summary);
  return { changed: true, summary };
}

export type { UpdateHost, UpdateRequest, UpdateSummary } from "./types";
