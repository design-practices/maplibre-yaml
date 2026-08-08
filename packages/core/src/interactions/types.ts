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
import type { CapabilityPolicy } from "../capabilities";

export type PopupContent = z.infer<typeof PopupContentSchema>;
export type InteractiveConfig = z.infer<typeof InteractiveConfigSchema>;
export type ClickConfig = NonNullable<NonNullable<InteractiveConfig>["click"]>;

/**
 * Config for the `flyTo` interaction, derived from the layer schema so a new
 * field there is a type error here rather than a silently dropped option.
 */
export type FlyToConfig = NonNullable<ClickConfig["flyTo"]>;

/**
 * Config for the `zoomToFeature` interaction, derived from the layer schema.
 *
 * @remarks
 * The camera-fitting sibling of {@link FlyToConfig}: `flyTo` flies to
 * author-fixed coordinates, `zoomToFeature` fits the clicked feature's own
 * bounds. Deriving the type from the schema keeps a new field there a type
 * error here rather than a silently dropped option.
 */
export type ZoomToFeatureConfig = NonNullable<ClickConfig["zoomToFeature"]>;

/**
 * Config for the `emit` interaction, derived from the layer schema.
 *
 * @remarks
 * `emit` names a host event and projects a declarative payload from the clicked
 * feature — the epic's host-hook seam. Deriving the type from the schema keeps a
 * new field there a type error here rather than a silently dropped option.
 */
export type EmitConfig = NonNullable<ClickConfig["emit"]>;

/** A resolved, JSON-serializable `emit` payload handed to a host handler. */
export type EmitPayload = Record<string, unknown>;

/**
 * The host-supplied handler map an `emit` interaction resolves event names
 * against — the emit-specific closed world.
 *
 * @remarks
 * Passed at attach time (the wiring that calls it lands in U5). Resolution is
 * closed-world, default-deny: only an own, registered key is a handler, so an
 * event name that is absent — or is merely a prototype method like `toString`
 * — is denied and nothing dispatches. The trust gate ({@link allowsHostHook})
 * is the outer guard; this map is the inner allowlist.
 */
export type InteractionHostHandlers = Record<
  string,
  (payload: EmitPayload) => void
>;

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
  /**
   * The host handler map the `emit` interaction resolves event names against.
   *
   * @remarks
   * Optional: an interaction that never emits (popup, flyTo, highlight) ignores
   * it, and an `emit` with no map supplied resolves every name to a denial —
   * closed-world default-deny. The wiring that populates this from an
   * `attachInteractions` call lands in U5; the built-in's *use* of it lands here.
   */
  hostHandlers?: InteractionHostHandlers;
  /**
   * The capability policy in force, gating the host-hook seam.
   *
   * @remarks
   * Optional so existing deps stubs stay valid; the `emit` built-in falls back
   * to {@link DEFAULT_POLICY} (untrusted) when it is absent, so a missing policy
   * denies the hook rather than opening it.
   */
  policy?: CapabilityPolicy;
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
