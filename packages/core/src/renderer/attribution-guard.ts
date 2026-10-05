/**
 * @file Keep unsanitized attribution away from MapLibre's attribution control
 * @module @maplibre-yaml/core/renderer
 *
 * @description
 * Sanitizing the strings the document spells out (`sources.*.attribution`,
 * `customAttribution`) is not enough on its own. A document also chooses URLs
 * whose responses carry attribution MapLibre renders as HTML: a basemap style
 * (`mapStyle: https://…`) and a TileJSON (`url:` on a vector/raster source).
 * Those strings arrive after load, inside MapLibre, where no document-side
 * sanitizer can reach them.
 *
 * What can reach them is ordering. The attribution control rebuilds its HTML
 * from `source.attribution` in a `styledata`/`sourcedata` listener, and
 * MapLibre fires listeners in registration order. So the renderer constructs
 * the map with the built-in control disabled, registers this guard first, and
 * only then adds the attribution control itself: every event that could make
 * the control read a new attribution passes through the guard, which rewrites
 * the source's `attribution` to its sanitized form, before the control sees it.
 *
 * Only public surface is touched (`map.on`, the `attribution` field of a
 * source object), plus a read of the style's source registry, which is named
 * `sourceCaches` before maplibre-gl 5.x's rename to `tileManagers`; both are
 * tried.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { sanitizeAttribution } from "../utils/attribution";

/** Installed guard: `scrub` re-sanitizes now, `dispose` removes listeners. */
export interface AttributionGuard {
  scrub(): void;
  dispose(): void;
}

const GUARDED_EVENTS = ["styledata", "sourcedata", "terrain"] as const;

/**
 * Register the attribution guard on `map`.
 *
 * @remarks
 * Must be called before any attribution control is added to `map` — the
 * control's own listeners have to come after this one. Sanitized strings are
 * memoized, so the per-event cost after the first pass is a Map lookup per
 * source.
 */
export function installAttributionGuard(map: MapLibreMap): AttributionGuard {
  const clean = new Map<unknown, string>();
  const sanitized = (value: unknown): string => {
    let result = clean.get(value);
    if (result === undefined) {
      result = sanitizeAttribution(value).html;
      clean.set(value, result);
      clean.set(result, result);
    }
    return result;
  };

  const scrub = (): void => {
    const style = (map as unknown as { style?: Record<string, unknown> }).style;
    if (!style) return;
    for (const registryKey of ["tileManagers", "sourceCaches"]) {
      const registry = style[registryKey];
      if (!registry || typeof registry !== "object") continue;
      for (const id of Object.keys(registry)) {
        const entry = (registry as Record<string, { getSource?: () => unknown }>)[id];
        const source = entry?.getSource?.() as { attribution?: unknown } | undefined;
        if (!source || source.attribution == null) continue;
        const value = sanitized(source.attribution);
        if (value !== source.attribution) {
          try {
            source.attribution = value;
          } catch {
            // A frozen source object cannot be fixed in place; nothing better
            // to do than leave it — MapLibre itself never freezes sources.
          }
        }
      }
    }
  };

  for (const event of GUARDED_EVENTS) map.on(event as "styledata", scrub);

  return {
    scrub,
    dispose() {
      for (const event of GUARDED_EVENTS) map.off(event as "styledata", scrub);
    },
  };
}
