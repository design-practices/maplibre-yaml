/**
 * @file Live documents: the fallback classification the renderer and `<ml-map>` share (KTD7, KTD13)
 * @module @maplibre-yaml/core/renderer/update
 *
 * @description
 * Decided synchronously in the entry, before the engine chunk is awaited and
 * before anything is mutated: a changed `mapStyle`, or a change to a Map
 * constructor option without a setter, means the update is a rebuild. The
 * element classifies the same way so it can flip its readiness state in the
 * same turn as the assignment (KTD8). `fallbackReason` in `diff.ts` mirrors
 * this inside the chunk (which may import nothing) and names the key.
 *
 * Types only from the rest of core: this file lives in `update/` and keeps
 * its import rule.
 */

import type { MapConfig } from "../../schemas/map.schema";

/** `config:` keys an update applies in place: the camera (KTD13), `fitTo`, and the options with a setter (KTD7). */
export const IN_PLACE_CONFIG_KEYS: ReadonlySet<string> = new Set([
  "center",
  "zoom",
  "bearing",
  "pitch",
  "fitTo",
  "minZoom",
  "maxZoom",
  "maxBounds",
]);

/** The `config:` keys that own the camera (KTD13). */
const CAMERA_KEYS = ["center", "zoom", "bearing", "pitch", "fitTo"] as const;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether `next` forces a rebuild (KTD7): a changed `mapStyle`, or any Map
 * constructor option without a setter (interaction handlers,
 * `canvasContextAttributes`, `renderWorldCopies`, ...).
 */
export function needsRebuild(applied: MapConfig, next: MapConfig): boolean {
  const a = applied as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  return Object.keys({ ...a, ...b }).some((key) => !IN_PLACE_CONFIG_KEYS.has(key) && !same(a[key], b[key]));
}

/** Whether the document's camera keys differ between `applied` and `next` (KTD13): a fallback rebuild keeps the current camera otherwise. */
export function cameraChanged(applied: MapConfig, next: MapConfig): boolean {
  const a = applied as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  return CAMERA_KEYS.some((key) => !same(a[key], b[key]));
}
