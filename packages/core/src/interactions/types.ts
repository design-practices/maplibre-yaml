/**
 * @file Interaction type surface and registry helpers
 * @module @maplibre-yaml/core/interactions
 *
 * @remarks
 * Named interactions ("popup", "flyTo") declared as data instead of branches
 * inside the event handler. `EventHandler` owns the listeners and lifecycle;
 * this module owns what each named interaction does.
 *
 * Nothing here may reach into `EventHandler` internals except through
 * {@link InteractionDeps}.
 */

import type { Map as MapLibreMap, LngLat } from "maplibre-gl";
import type { z } from "zod";
import { PopupContentSchema, InteractiveConfigSchema } from "../schemas";

export type PopupContent = z.infer<typeof PopupContentSchema>;
export type InteractiveConfig = z.infer<typeof InteractiveConfigSchema>;
export type ClickConfig = NonNullable<NonNullable<InteractiveConfig>["click"]>;

/**
 * Config for the `flyTo` interaction, derived from the layer schema so a new
 * field there is a type error here rather than a silently dropped option.
 */
export type FlyToConfig = NonNullable<ClickConfig["flyTo"]>;

/**
 * What every interaction receives when its trigger fires.
 */
export interface InteractionContext {
  map: MapLibreMap;
  layerId: string;
  /**
   * The MapLibre source backing this layer. Derived the same way
   * `LayerManager` derives it, so feature-state writes address the same source
   * the data actually lives in.
   */
  sourceId: string;
  feature: any;
  lngLat: LngLat;
}

/**
 * Renderer-owned services lent to interactions that need more than the map.
 *
 * @remarks
 * This is the seam that keeps interactions extractable, but it is not yet a
 * capability boundary: {@link InteractionContext.map} is the raw MapLibre
 * instance, so an interaction can still reach anything on it. Narrowing that
 * is part of the extraction, not of this unit.
 */
export interface InteractionDeps {
  showPopup: (content: PopupContent, feature: any, lngLat: LngLat) => void;
}

/**
 * One named interaction: where to find its config on a trigger, and what to do.
 *
 * @remarks
 * `name` is the stable handler id this interaction keeps when the registry
 * moves out of core. It is documentation and future lookup only — nothing
 * resolves handlers by name yet, and the closed-world strict-mode resolution
 * the direction doc calls for is not implemented here.
 *
 * `select` is the only coupling to the schema's shape, and it decides
 * *configured-ness*: return `undefined` for absent **or disabled**. Callers
 * must not assume a present key means enabled — `hover.highlight` is a plain
 * boolean, so `false` is a present-but-off value.
 */
export interface Interaction<TConfig = unknown> {
  name: string;
  select: (trigger: any) => TConfig | undefined;
  /**
   * Build this interaction's per-`EventHandler` runtime.
   *
   * @remarks
   * A factory, not a bare `run`, because interactions are not all
   * fire-and-forget: `highlight` tracks which feature is lit per layer and has
   * to unset it on several lifecycle events. That state must be per handler
   * instance — the registry itself is module-level and shared — so each
   * interaction closes over its own, and nothing leaks into `EventHandler`.
   */
  create: (deps: InteractionDeps) => InteractionRuntime<TConfig>;
}

/** The live half of an interaction, owning whatever state it needs. */
export interface InteractionRuntime<TConfig = unknown> {
  run: (config: TConfig, ctx: InteractionContext) => void;
  /**
   * Release state held for one layer. Called on mouseleave, `detachEvents`,
   * and `destroy` — anywhere the tracked feature may no longer be valid.
   */
  clearLayer?: (layerId: string, map: MapLibreMap) => void;
}

/**
 * Identity helper that keeps each entry's `select` and `run` types checked
 * against each other while still allowing a heterogeneous registry array.
 */
export const defineInteraction = <T>(
  interaction: Interaction<T>
): Interaction<any> => interaction;

/** Wrap a stateless effect in the runtime shape. */
export const stateless =
  <T>(run: (config: T, ctx: InteractionContext, deps: InteractionDeps) => void) =>
  (deps: InteractionDeps): InteractionRuntime<T> => ({
    run: (config, ctx) => run(config, ctx, deps),
  });
