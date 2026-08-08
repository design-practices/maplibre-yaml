/**
 * @file Project the model's runtime half into a declarative interactions manifest
 * @module @maplibre-yaml/core/interactions
 *
 * @description
 * `projectInteractions` is the runtime-half sibling of the emitter's
 * `projectStyle`: where `projectStyle` walks `layer.spec` into a spec-valid
 * `style.json`, this walks `layer.runtime.interactive` into an in-memory,
 * declarative interactions projection — `{ layers: { [id]: { source,
 * interactive } } }`. It is pure data, no functions, so it honors the format
 * law (nothing here could ever live in `style.json`) and travels to a host that
 * owns its own `maplibregl.Map`.
 *
 * Two facts the projection must carry that the interactive config alone does
 * not:
 *
 * - **The layer's `source` id.** `highlight` writes
 *   `setFeatureState({ source, id })`, and the source lives in the *style* half
 *   (`layer.spec.source`), not the interactive config. A projection of only
 *   `InteractiveConfig` could not drive highlight, so the source id is resolved
 *   here — the same derivation `EventHandler`/`LayerManager` use — and carried
 *   on every entry.
 * - **The trust decision.** Under an untrusted policy the `emit` block is
 *   dropped at projection time (fail-closed), so an untrusted projection never
 *   even carries host-hook instructions into the page. An absent policy is
 *   treated as {@link DEFAULT_POLICY} (untrusted), so a forgotten policy drops
 *   `emit` rather than smuggling it through.
 */

import type { MapModel } from "../model/types";
import {
  allowsHostHook,
  DEFAULT_POLICY,
  type CapabilityPolicy,
} from "../capabilities";
import type { InteractiveConfig } from "./types";

/** The interactive config carried by a projected layer — always present. */
export type ProjectedInteractiveConfig = NonNullable<InteractiveConfig>;

/** One projected layer: the source id feature-state addresses, and its config. */
export interface ProjectedLayerInteractions {
  /**
   * The MapLibre source backing this layer, derived exactly as
   * `EventHandler`/`LayerManager` derive it, so `highlight`'s
   * `setFeatureState({ source, id })` addresses the source the data lives in.
   */
  source: string;
  /** The declarative interactive config — popup/flyTo/highlight/zoomToFeature/emit. */
  interactive: ProjectedInteractiveConfig;
}

/**
 * A declarative interactions projection: every interactive layer keyed by id.
 *
 * @remarks
 * Pure data — no handlers, no closures. This is what `attachInteractions`
 * consumes to wire listeners onto a host-owned or compiled map, and what a
 * future CLI could serialize beside `style.json`.
 */
export interface InteractionsProjection {
  layers: Record<string, ProjectedLayerInteractions>;
}

/**
 * Deep-clone the declarative interactive config so the projection is
 * independent of the model and safe to mutate (the `emit` drop below).
 *
 * @remarks
 * The config is JSON-serializable declarative data by construction (the shapes
 * `InteractiveConfigSchema` validates), so a structured clone is faithful and
 * carries no functions. `structuredClone` is preferred; the `JSON` round trip
 * is a fallback for any runtime that lacks it.
 */
function cloneInteractive(
  interactive: ProjectedInteractiveConfig
): ProjectedInteractiveConfig {
  if (typeof structuredClone === "function") {
    return structuredClone(interactive);
  }
  return JSON.parse(JSON.stringify(interactive)) as ProjectedInteractiveConfig;
}

/**
 * Project the model's per-layer interactions into a declarative manifest.
 *
 * @param model - The normalized map model.
 * @param policy - The capability policy in force; an absent policy defaults to
 *   {@link DEFAULT_POLICY} (untrusted), which drops `emit` blocks.
 * @returns A projection keyed by layer id. A layer with no interactive config
 *   yields no entry.
 */
export function projectInteractions(
  model: MapModel,
  policy: CapabilityPolicy = DEFAULT_POLICY
): InteractionsProjection {
  const layers: Record<string, ProjectedLayerInteractions> = {};
  const hostHooksAllowed = allowsHostHook(policy);

  for (const layer of model.style.layers) {
    const interactive = layer.runtime["interactive"] as
      | InteractiveConfig
      | undefined;
    // No interactive config → no entry, matching `EventHandler`'s
    // `if (!layer.interactive) return`. A non-object value is malformed and
    // treated the same way rather than projected.
    if (!interactive || typeof interactive !== "object") continue;

    const id = String(layer.spec["id"] ?? "");
    // Source id, derived exactly as LayerManager/EventHandler derive it: a
    // string source is a named reference; an inline source object is backed by
    // a synthesized `${id}-source`.
    const rawSource = layer.spec["source"];
    const source =
      typeof rawSource === "string" ? rawSource : `${id}-source`;

    const projected = cloneInteractive(interactive as ProjectedInteractiveConfig);

    // Fail-closed: an untrusted projection never carries the host-hook seam.
    // Dropping at projection time (rather than refusing at attach) means the
    // instruction is simply not present in the artifact an untrusted room gets.
    if (!hostHooksAllowed && projected.click && "emit" in projected.click) {
      const { emit: _dropped, ...restClick } = projected.click as Record<
        string,
        unknown
      >;
      projected.click = restClick as ProjectedInteractiveConfig["click"];
    }

    layers[id] = { source, interactive: projected };
  }

  return { layers };
}
