/**
 * @file Live documents: the equality and document-reading helpers the chunk shares (0.10, ml-4ug)
 * @module @maplibre-yaml/core/renderer/update
 *
 * @description
 * One notion of "same" for the differ (`diff.ts`) and the runtime re-sync
 * (`resync.ts`): structural equality by JSON, behind a reference check so a
 * value the next document shares with the applied one — an inline GeoJSON
 * payload the host did not touch — costs nothing to compare. `rebuild.ts`
 * keeps its own one-liner: it is imported by the entry, and this module
 * must stay inside the chunk.
 *
 * Type-only imports beside nothing: this module ships in the engine's lazy
 * chunk, which shares nothing with the main bundle (KTD10).
 */

import type { Layer } from "../../schemas/layer.schema";

export type Obj = Record<string, unknown>;

/** Structural equality: the same reference, or the same JSON. */
export function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function asObject(value: unknown): Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Obj) : {};
}

/** Keys present in either object whose values differ, in first-seen order; `skip` names keys compared elsewhere. */
export function changedKeys(a: Obj, b: Obj, skip?: ReadonlySet<string>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => !skip?.has(key) && !same(a[key], b[key]));
}

/** The id of the source a layer draws: its named source, or its own inline one (`${layerId}-source`). */
export function sourceIdOf(layer: Layer): string | undefined {
  if (layer.type === "background") return undefined;
  return typeof layer.source === "string" ? layer.source : `${layer.id}-source`;
}
