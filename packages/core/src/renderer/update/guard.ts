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

/** `MapErrorContext.reason` for a document layer whose id a host's layer holds (KTD1): the host's is left alone. */
export const HOST_LAYER_COLLISION = "host-layer-collision";

/** The collision's error (`consequence`: "so …"), carrying its reason for the context so hosts branch on it rather than on the wording. */
export function hostLayerCollision(layerId: string, consequence: string): Error {
  return Object.assign(
    new Error(
      `Layer "${layerId}" is on the map but was not declared by the document ` +
        `(a host added it through addLayer or getMap().addLayer), ${consequence}. Give one of them another id.`
    ),
    { reason: HOST_LAYER_COLLISION }
  );
}

/** `context` with the typed reason the error carries, when it carries one. */
export function contextOf(error: Error, context?: MapErrorContext): MapErrorContext | undefined {
  return context && (error as { reason?: unknown }).reason === HOST_LAYER_COLLISION ? { ...context, reason: HOST_LAYER_COLLISION } : context;
}

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
  given?: MapErrorContext
): Promise<void> {
  try {
    await run();
  } catch (thrown) {
    const error = thrown instanceof Error ? thrown : new Error(String(thrown));
    const context = contextOf(error, given);
    summary.failures.push({
      op,
      message: error.message,
      ...(context?.layerId !== undefined ? { layerId: context.layerId } : {}),
      ...(context?.sourceId !== undefined ? { sourceId: context.sourceId } : {}),
    });
    host.onError(error, context);
  }
}
