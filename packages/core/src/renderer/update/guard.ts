/**
 * @file Live documents: the one per-operation failure wrapper (0.10, ml-4ug, KTD7)
 * @module @maplibre-yaml/core/renderer/update
 *
 * @description
 * Every operation the apply step runs and every step of the runtime re-sync
 * goes through `guard`: a throw becomes a `summary.failures` record naming
 * the operation and the layer or source it was about, and a non-fatal
 * `onError` report through the renderer's own channel, and the update goes
 * on (KTD7). Nothing an update does is fatal to the map.
 *
 * Type-only imports: this module ships in the engine's lazy chunk.
 */

import type { MapErrorContext } from "../map-renderer";
import type { UpdateHost, UpdateSummary } from "./types";

export const layerContext = (layerId: string): MapErrorContext => ({ kind: "layer", layerId });
export const sourceContext = (sourceId: string): MapErrorContext => ({ kind: "source", sourceId });

/**
 * Run one operation or re-sync step; a throw is recorded under `op` (the
 * operation's name) with the layer or source id from `context`, reported
 * non-fatally, and never fatal.
 */
export async function guard(
  host: UpdateHost,
  summary: UpdateSummary,
  op: string,
  run: () => void | Promise<void>,
  context?: MapErrorContext
): Promise<void> {
  try {
    await run();
  } catch (thrown) {
    const error = thrown instanceof Error ? thrown : new Error(String(thrown));
    summary.failures.push({
      op,
      message: error.message,
      ...(context?.layerId !== undefined ? { layerId: context.layerId } : {}),
      ...(context?.sourceId !== undefined ? { sourceId: context.sourceId } : {}),
    });
    host.onError(error, context);
  }
}
