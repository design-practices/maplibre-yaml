/**
 * @file Built-in interaction registry entries
 * @module @maplibre-yaml/core/interactions
 *
 * @remarks
 * The named interactions shipped with core, declared as data. Order within
 * each registry array is behavior — see the per-array remarks.
 */

import type {
  Map as MapLibreMap,
  FlyToOptions,
  FitBoundsOptions,
} from "maplibre-gl";
import {
  defineInteraction,
  stateless,
  type Interaction,
  type PopupContent,
  type FlyToConfig,
  type ZoomToFeatureConfig,
  type EmitConfig,
  type EmitPayload,
} from "./types";
import { geometryBounds } from "./geometry-bounds";
import { allowsHostHook, DEFAULT_POLICY } from "../capabilities";

/**
 * Resolve an `emit` payload spec into a plain, JSON-serializable object.
 *
 * @remarks
 * Each key is a declarative projection: `str` is a literal, `property` reads the
 * feature property (with an `else` fallback). A property that is missing or
 * null yields a **defined-absent** value — the key is present with `null`, never
 * omitted and never a throw — so a host handler sees a stable payload shape
 * regardless of which features carry which properties.
 */
function projectEmitPayload(
  spec: EmitConfig["payload"],
  properties: Record<string, unknown>
): EmitPayload {
  const payload: EmitPayload = {};
  if (!spec) return payload;

  for (const [key, item] of Object.entries(spec)) {
    if (!item) continue;
    if (item.str !== undefined) {
      payload[key] = item.str;
      continue;
    }
    if (item.property !== undefined) {
      const value = properties[item.property];
      if (value !== undefined && value !== null) {
        payload[key] = value;
      } else {
        // Defined-absent: the key stays in the payload with the declared
        // fallback, or null when none was declared.
        payload[key] = item.else ?? null;
      }
      continue;
    }
    // An item with neither `str` nor `property` still occupies its key.
    payload[key] = null;
  }
  return payload;
}

/**
 * Click interactions, in dispatch order.
 *
 * @remarks
 * Order is behavior: `popup` runs before the camera interactions (`flyTo`,
 * `zoomToFeature`) so the popup opens at the clicked point and then travels
 * with the camera. `flyTo` and `zoomToFeature` are mutually exclusive in
 * practice — one flies to author-fixed coordinates, the other fits the clicked
 * feature's own bounds — so their relative order is inert; what matters is that
 * both follow popup. Adding an interaction means adding an entry here, not
 * another branch in the click handler.
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
  defineInteraction<ZoomToFeatureConfig>({
    name: "zoomToFeature",
    select: (trigger) => trigger.zoomToFeature,
    create: stateless((config: ZoomToFeatureConfig, ctx) => {
      // Fit the camera to the clicked feature's *own* bounds — the flyTo
      // sibling that reads geometry rather than author-fixed coordinates.
      const bounds = geometryBounds(ctx.feature?.geometry);
      // Missing/empty geometry has nothing to fit: no-op, never throw.
      if (!bounds) return;

      // Omit unset options so MapLibre's own defaults apply. `!== undefined`
      // rather than truthiness, because 0 is meaningful for padding/duration.
      const options: FitBoundsOptions = {};
      if (config.padding !== undefined) options.padding = config.padding;
      if (config.maxZoom !== undefined) options.maxZoom = config.maxZoom;
      if (config.duration !== undefined) options.duration = config.duration;

      ctx.map.fitBounds(bounds, options);
    }),
  }),
  // NOTE (emit dispatch surface, R9 deferred): emit only actually dispatches
  // through `attachInteractions`, which threads `hostHandlers`/`policy` into the
  // deps it builds. The live `<ml-map>` renderer (`EventHandler`) binds this
  // built-in — it is in CLICK_INTERACTIONS — but does NOT thread
  // `hostHandlers`/`policy` into its `interactionDeps`, so under the renderer an
  // `emit` resolves every event to a denial and is inert (a silent no-op) even
  // for a trusted document. That is intended, not a latent footgun: emit targets
  // the attach path this epic added; wiring it into the renderer is R9 work.
  defineInteraction<EmitConfig>({
    name: "emit",
    select: (trigger) => trigger.emit,
    create: stateless((config: EmitConfig, ctx, deps) => {
      // Trust gate first: the host-hook seam is default-deny outside a trusted
      // context, so an untrusted document that names an event finds emit inert.
      // A missing policy falls back to DEFAULT_POLICY (untrusted) — absent means
      // denied, never open.
      if (!allowsHostHook(deps.policy ?? DEFAULT_POLICY)) return;

      // Closed-world resolution against the host handler map. Own registered
      // keys only: an unknown name — or a prototype method like `toString` —
      // resolves to nothing and is denied, never dispatched.
      const handlers = deps.hostHandlers;
      const handler =
        handlers &&
        Object.prototype.hasOwnProperty.call(handlers, config.event)
          ? handlers[config.event]
          : undefined;

      if (typeof handler !== "function") {
        console.warn(
          `[maplibre-yaml] emit event "${config.event}" has no registered ` +
            "host handler; it is denied and nothing is dispatched. Register a " +
            "handler for it in the host handler map to enable this event."
        );
        return;
      }

      const properties = (ctx.feature?.properties ?? {}) as Record<
        string,
        unknown
      >;
      handler(projectEmitPayload(config.payload, properties));
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
