/**
 * @file Attach effects to a live map, and validate effect blocks
 * @module @maplibre-yaml/effects
 *
 * @description
 * The programmatic entry point (`attachEffects`) and what the core host
 * hook delegates to. Works on any MapLibre map whose style already holds the
 * static layers — an `<ml-map>` (which calls this automatically once the
 * package is registered) or a vanilla map over an exported style.
 *
 * @experimental
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import type { AttachOptions, BackendHandle } from "./contract";
import { effectRegistry, type EffectRegistry } from "./registry";
import { warnOnce } from "./log";

/** An authored `effect:` block. @experimental */
export interface EffectBlock {
  type: string;
  [param: string]: unknown;
}

/** One problem with an effect block (path relative to the block). @experimental */
export interface EffectIssue {
  path: (string | number)[];
  message: string;
}

/** A layer carrying an effect. @experimental */
export interface EffectLayerRef {
  layerId: string;
  effect: EffectBlock;
}

/** One attached (or declared-absent) effect. @experimental */
export interface AttachedEffect {
  layerId: string;
  type: string;
  /** The backend's handle; absent when the block itself was invalid. */
  handle?: BackendHandle;
  /** Why the effect is not drawing, when it is not. */
  readonly reason?: string;
  readonly active: boolean;
  /** Remove this one effect (its static layer returns). Idempotent. */
  detach(): void;
}

/** Everything `attachEffects` attached to one map. @experimental */
export interface EffectsHandle {
  readonly effects: AttachedEffect[];
  /** Resolves when every active effect has built its visible tiles. */
  ready(): Promise<void>;
  /** Remove every effect and restore the static layers. Idempotent. */
  detach(): void;
}

const attached = new WeakMap<MapLibreMap, Set<AttachedEffect>>();

/**
 * Validate an effect block against the registry: type known, params valid.
 *
 * @experimental
 */
export function validateEffect(effect: EffectBlock, registry: EffectRegistry = effectRegistry): EffectIssue[] {
  const definition = registry.get(effect.type);
  if (!definition) {
    const known = registry.types();
    return [
      {
        path: ["type"],
        message:
          `Unknown effect "${effect.type}". ` +
          (known.length ? `Registered effects: ${known.join(", ")}.` : "No effects are registered."),
      },
    ];
  }
  const { type: _type, ...params } = effect;
  const result = definition.params.safeParse(params);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    path: issue.path,
    message: `${effect.type}: ${issue.message}`,
  }));
}

/**
 * Attach effects to layers already in the map's style.
 *
 * Never throws for an unsupported environment or a bad block: each effect
 * that cannot draw declares absence (one console warning) and its static
 * layer stays visible.
 *
 * @experimental
 *
 * @example
 * ```ts
 * import "@maplibre-yaml/effects/register";
 * import { attachEffects } from "@maplibre-yaml/effects";
 * const fx = attachEffects(map, [{ layerId: "buildings", effect: { type: "tonal-hatch" } }]);
 * await fx.ready();
 * // later
 * fx.detach();
 * ```
 */
export function attachEffects(
  map: MapLibreMap,
  layers: EffectLayerRef[],
  options: AttachOptions = {},
  registry: EffectRegistry = effectRegistry
): EffectsHandle {
  let set = attached.get(map);
  if (!set) {
    set = new Set();
    attached.set(map, set);
  }
  const live = set;
  const effects: AttachedEffect[] = layers.map(({ layerId, effect }) => {
    const definition = registry.get(effect.type);
    const issues = validateEffect(effect, registry);
    let entry: AttachedEffect;
    if (!definition || issues.length) {
      const reason = issues.map((i) => `${i.path.join(".") || "effect"}: ${i.message}`).join("; ");
      warnOnce(`[effects] effect on "${layerId}" is not drawn (${reason}); the static layer renders instead.`);
      entry = { layerId, type: effect.type, reason, active: false, detach: () => void live.delete(entry) };
    } else {
      const { type: _type, ...raw } = effect;
      const params = definition.params.parse(raw);
      const handle = definition.backend.attach({ map, layerId, definition, params, options });
      entry = {
        layerId,
        type: effect.type,
        handle,
        get reason() {
          return handle.reason;
        },
        get active() {
          return handle.active;
        },
        detach() {
          handle.detach();
          live.delete(entry);
        },
      };
    }
    live.add(entry);
    return entry;
  });

  return {
    effects,
    ready: () => Promise.all(effects.map((e) => e.handle?.ready())).then(() => undefined),
    detach() {
      for (const e of effects) e.detach();
    },
  };
}

/**
 * The effects currently attached to a map (by `<ml-map>` or by hand), for
 * inspection and tests.
 *
 * @experimental
 */
export function getAttachedEffects(map: MapLibreMap): AttachedEffect[] {
  return [...(attached.get(map) ?? [])];
}
