/**
 * @file The effects host — this package's side of core's hook
 * @module @maplibre-yaml/effects
 *
 * @description
 * `@maplibre-yaml/core` owns the `effect:` key but never imports this
 * package. Instead this package installs a *host* into a realm-wide slot
 * (`globalThis[Symbol.for("@maplibre-yaml/effects-host")]`) that core reads:
 * to validate params at parse time, to auto-attach in `<ml-map>`, and to run
 * each effect's `fallback()` on emit. The slot protocol is mirrored here, not
 * imported, so this package has no runtime dependency on core (and works
 * however many core bundles a page loads).
 *
 * @experimental
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { effectRegistry, type EffectRegistry } from "./registry";
import { attachEffects, validateEffect, type EffectBlock, type EffectIssue, type EffectLayerRef } from "./attach";

/** Structurally identical to core's `EffectsHost` (apiVersion 1). @experimental */
export interface EffectsHostV1 {
  readonly apiVersion: 1;
  types(): string[];
  validate(effect: EffectBlock): EffectIssue[];
  attach(map: MapLibreMap, layers: EffectLayerRef[]): { detach(): void };
  lower(effect: EffectBlock, layer: Record<string, unknown>): Record<string, unknown> | null | undefined;
}

/** Build a host over a registry. @experimental */
export function createEffectsHost(registry: EffectRegistry = effectRegistry): EffectsHostV1 {
  return {
    apiVersion: 1,
    types: () => registry.types(),
    validate: (effect) => validateEffect(effect, registry),
    attach: (map, layers) => attachEffects(map, layers, {}, registry),
    lower(effect, layer) {
      const definition = registry.get(effect.type);
      if (!definition) return undefined;
      const { type: _type, ...raw } = effect;
      const parsed = definition.params.safeParse(raw);
      if (!parsed.success) return undefined;
      return definition.fallback(parsed.data, layer);
    },
  };
}

const SLOT = Symbol.for("@maplibre-yaml/effects-host");

interface Slot {
  host?: EffectsHostV1;
  listeners: Set<(host: EffectsHostV1) => void>;
}

let installed: EffectsHostV1 | null = null;

/**
 * Install the default-registry host where core looks for it. Idempotent;
 * returns the installed host. A *different* host already in the slot (a
 * second copy of this package) is left in place — two runtimes must not
 * race for the same layers — and reported once.
 *
 * @experimental
 */
export function installEffectsHost(): EffectsHostV1 {
  if (installed) return installed;
  const g = globalThis as unknown as Record<symbol, Slot | undefined>;
  let slot = g[SLOT];
  if (!slot) {
    slot = { listeners: new Set() };
    g[SLOT] = slot;
  }
  if (slot.host) {
    console.warn(
      "[effects] another copy of @maplibre-yaml/effects already registered with core; " +
        "this copy's registry is not used. Load the package once per page."
    );
    installed = slot.host;
    return installed;
  }
  installed = createEffectsHost();
  slot.host = installed;
  for (const listener of [...slot.listeners]) listener(installed);
  return installed;
}
