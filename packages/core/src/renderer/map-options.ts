/**
 * @file Map options whose shape depends on the running maplibre-gl (ml-vwz)
 * @module @maplibre-yaml/core/renderer
 *
 * @description
 * MapLibre 6.14–6.16 gave three `Map` options a shape the library mirrors
 * verbatim (`config:` is MapLibre's own vocabulary). Each has a floor; below
 * it the value is shaped so the map still does the nearest right thing, and
 * a notice says what was declared and what the runtime does instead (the
 * declared-absence posture, as `scene-3d.ts` does for terrain and sky):
 *
 * - `dragRotate: { around, movement }` (6.15, `DragRotateOptions`): below the
 *   floor the handler is enabled plainly (`true`) — the map still rotates.
 * - `maxBounds: [-Infinity, south, Infinity, north]` (6.16, `setMaxBounds`:
 *   "Use `-Infinity` and `Infinity` for an unconstrained longitude range,
 *   with finite latitude limits"): below the floor an infinite longitude
 *   breaks the constrain maths, so the longitude closes at ±180 and the
 *   latitude limit — the author's point — holds.
 * - `state:` defaults as the constructor's `globalState` (6.14): below the
 *   floor there is no such option; `setGlobalStateProperty` applies them on
 *   load (and does on every runtime for live updates and after a `setStyle`).
 *
 * An unknown version is not a claim the floor is met (`CapabilityPolicy`):
 * each falls back. Pure over data, so the renderer and the live-update path
 * shape a value the same way, and both are tested without MapLibre.
 */

import {
  DRAG_ROTATE_OPTIONS_RUNTIME_FLOOR,
  GLOBAL_STATE_OPTION_RUNTIME_FLOOR,
  MAX_BOUNDS_OPEN_LONGITUDE_RUNTIME_FLOOR,
  meetsVersion,
} from "../capabilities";
import { toFlatBounds } from "../utils/bounds";
import { stateDefault } from "./params-builder";

/** A value as the runtime takes it, and the notice to print when it was reshaped. */
export interface RuntimeShaped<T> {
  value: T;
  notice?: string;
}

/** "`key: value` needs maplibre-gl X or later (running Y); <what happens instead>." */
const notice = (key: string, written: string, floor: string, version: string | undefined, instead: string) =>
  `this document declares \`${key}: ${written}\`, but that needs maplibre-gl ${floor} or later ` +
  `(${version ? `running ${version}` : "version unknown"}); ${instead}.`;

/**
 * `dragRotate` as the running maplibre-gl takes it: a boolean on any runtime;
 * the options object from 6.15, `true` with a notice before that.
 */
export function dragRotateForRuntime(value: unknown, version: string | undefined): RuntimeShaped<unknown> {
  if (value === null || typeof value !== "object") return { value };
  if (meetsVersion(version, DRAG_ROTATE_OPTIONS_RUNTIME_FLOOR)) return { value };
  return {
    value: true,
    notice: notice("dragRotate", JSON.stringify(value), DRAG_ROTATE_OPTIONS_RUNTIME_FLOOR, version, "the map rotates as `dragRotate: true`"),
  };
}

/**
 * `maxBounds` as the running maplibre-gl takes it: anything but an open
 * longitude (`-Infinity` west with `Infinity` east, in either bounds form)
 * passes through on any runtime; an open longitude passes through from 6.16
 * and before that is closed at ±180 — as the flat `[-180, south, 180, north]`
 * whatever form the author wrote, since MapLibre takes either — with a notice.
 */
export function maxBoundsForRuntime(value: unknown, version: string | undefined): RuntimeShaped<unknown> {
  const flat = toFlatBounds(value, { openLongitude: true });
  const open = flat !== null && flat[0] === -Infinity && flat[2] === Infinity;
  if (!open || meetsVersion(version, MAX_BOUNDS_OPEN_LONGITUDE_RUNTIME_FLOOR)) return { value };
  const [, south, , north] = flat;
  return {
    value: [-180, south, 180, north],
    notice: notice("maxBounds", `[-.inf, ${south}, .inf, ${north}]`, MAX_BOUNDS_OPEN_LONGITUDE_RUNTIME_FLOOR, version, "the latitude limits hold with longitude closed at ±180"),
  };
}

/**
 * The document's `state:` defaults as the constructor's `globalState`
 * option, on a runtime that has one (6.14+); `undefined` otherwise, or when
 * no key declares a default — the setter path then does the work on load.
 */
export function globalStateForRuntime(
  state: Record<string, unknown> | undefined,
  version: string | undefined
): Record<string, unknown> | undefined {
  if (!state || !meetsVersion(version, GLOBAL_STATE_OPTION_RUNTIME_FLOOR)) return undefined;
  const defaults: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(state)) {
    const value = stateDefault(entry);
    if (value !== undefined) defaults[key] = value;
  }
  return Object.keys(defaults).length > 0 ? defaults : undefined;
}
