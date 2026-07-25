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
  run: (config: TConfig, ctx: InteractionContext, deps: InteractionDeps) => void;
}

/**
 * Identity helper that keeps each entry's `select`/`run` types checked against
 * each other while still allowing a heterogeneous registry array.
 */
const defineInteraction = <T>(interaction: Interaction<T>): Interaction<any> =>
  interaction;

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
    run: (content, ctx, deps) => deps.showPopup(content, ctx.feature, ctx.lngLat),
  }),
  defineInteraction<FlyToConfig>({
    name: "flyTo",
    select: (trigger) => trigger.flyTo,
    run: (config, ctx) => {
      // Center defaults to the clicked point. zoom/duration are omitted when
      // unset so MapLibre's own defaults apply — `!== undefined` rather than a
      // truthiness check, because 0 is meaningful for both.
      const options: FlyToOptions = {
        center: config.center ?? ctx.lngLat,
      };
      if (config.zoom !== undefined) options.zoom = config.zoom;
      if (config.duration !== undefined) options.duration = config.duration;

      ctx.map.flyTo(options);
    },
  }),
];
