/**
 * @file Proto-interactions registry for layer event handling
 * @module @maplibre-yaml/core/renderer
 *
 * @remarks
 * Named interactions ("popup", "flyTo") declared as data instead of branches
 * inside the event handler. `EventHandler` owns the listeners and lifecycle;
 * this module owns what each named interaction does.
 *
 * This file is the unit the planned interactions package extracts — it moves
 * wholesale, so nothing here may reach into `EventHandler` internals except
 * through {@link InteractionDeps}.
 *
 * @internal
 * Not part of the published API. These symbols are deliberately absent from
 * the package barrel: extensibility is eject-to-JS plus slots, not a plugin
 * registry, so do not re-export them without revisiting that decision.
 */

import type { Map as MapLibreMap, LngLat, FlyToOptions } from "maplibre-gl";
import type { z } from "zod";
import { PopupContentSchema, InteractiveConfigSchema } from "../schemas";

type PopupContent = z.infer<typeof PopupContentSchema>;
type InteractiveConfig = z.infer<typeof InteractiveConfigSchema>;
type ClickConfig = NonNullable<NonNullable<InteractiveConfig>["click"]>;

/**
 * Config for the `flyTo` interaction, derived from the layer schema so a new
 * field there is a type error here rather than a silently dropped option.
 */
type FlyToConfig = NonNullable<ClickConfig["flyTo"]>;

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
const defineInteraction = <T>(interaction: Interaction<T>): Interaction<any> =>
  interaction;

/** Wrap a stateless effect in the runtime shape. */
const stateless =
  <T>(run: (config: T, ctx: InteractionContext, deps: InteractionDeps) => void) =>
  (deps: InteractionDeps): InteractionRuntime<T> => ({
    run: (config, ctx) => run(config, ctx, deps),
  });

/**
 * Click interactions, in dispatch order.
 *
 * @remarks
 * Order is behavior: `popup` runs before `flyTo` so the popup opens at the
 * clicked point and then travels with the camera. Adding an interaction means
 * adding an entry here, not another branch in the click handler.
 */
export const CLICK_INTERACTIONS: readonly Interaction[] = [
  defineInteraction<PopupContent>({
    name: "popup",
    select: (trigger) => trigger.popup,
    create: stateless((content, ctx, deps) =>
      deps.showPopup(content, ctx.feature, ctx.lngLat)
    ),
  }),
  defineInteraction<FlyToConfig>({
    name: "flyTo",
    select: (trigger) => trigger.flyTo,
    create: stateless((config: FlyToConfig, ctx) => {
      // Center defaults to the clicked point. zoom/duration are omitted when
      // unset so MapLibre's own defaults apply — `!== undefined` rather than a
      // truthiness check, because 0 is meaningful for both.
      const options: FlyToOptions = {
        center: config.center ?? ctx.lngLat,
      };
      if (config.zoom !== undefined) options.zoom = config.zoom;
      if (config.duration !== undefined) options.duration = config.duration;

      ctx.map.flyTo(options);
    }),
  }),
];

/**
 * The feature-state key `highlight` writes.
 *
 * @remarks
 * Shared with the paint rewrite in `LayerManager`, which reads the same key
 * back out via `["feature-state", ...]`. These are two halves of one contract:
 * if the written key and the read key drift apart, both sides stay individually
 * valid — the expression still compiles, the state write still succeeds — and
 * highlighting silently stops working. Importing one constant makes that
 * drift impossible rather than merely tested for.
 */
export const HOVER_FEATURE_STATE_KEY = "hover";

/**
 * Hover interactions, in dispatch order.
 *
 * @remarks
 * Driven by `mousemove`, not `mouseenter`: MapLibre fires `mouseenter` once
 * when the pointer enters the layer, not per feature, so it cannot tell which
 * feature is under the cursor as you move across them.
 */
export const HOVER_INTERACTIONS: readonly Interaction[] = [
  defineInteraction<boolean>({
    name: "highlight",
    select: (trigger) => trigger.highlight,
    create: () => {
      /** The lit feature per layer — per handler instance, never shared. */
      const lit = new Map<string, { sourceId: string; featureId: string | number }>();
      /** Warn once per layer, not once per mousemove. */
      const warned = new Set<string>();

      const unset = (
        map: MapLibreMap,
        entry: { sourceId: string; featureId: string | number }
      ) => {
        map.setFeatureState(
          { source: entry.sourceId, id: entry.featureId },
          { [HOVER_FEATURE_STATE_KEY]: false }
        );
      };

      return {
        run(_config, ctx) {
          const featureId = ctx.feature?.id;

          if (featureId === undefined || featureId === null) {
            // Feature-state is addressed by id; without one there is nothing to
            // target. Authors fix this with `generateId: true` or `promoteId`.
            if (!warned.has(ctx.layerId)) {
              warned.add(ctx.layerId);
              console.warn(
                `[maplibre-yaml] hover.highlight on layer "${ctx.layerId}" ` +
                  "needs feature ids. Set `generateId: true` on the source, or " +
                  "`promoteId` to use a property as the id."
              );
            }
            return;
          }

          const current = lit.get(ctx.layerId);
          if (current?.featureId === featureId) return; // same feature, no churn

          if (current) unset(ctx.map, current);
          ctx.map.setFeatureState(
            { source: ctx.sourceId, id: featureId },
            { [HOVER_FEATURE_STATE_KEY]: true }
          );
          lit.set(ctx.layerId, { sourceId: ctx.sourceId, featureId });
        },

        clearLayer(layerId, map) {
          const current = lit.get(layerId);
          if (!current) return;
          unset(map, current);
          lit.delete(layerId);
        },
      };
    },
  }),
];
