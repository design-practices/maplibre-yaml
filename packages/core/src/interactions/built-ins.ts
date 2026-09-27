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
  type InteractionContext,
  type InteractionDeps,
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
 * The shared `emit` dispatch: trust gate, closed-world host-handler resolution,
 * and payload projection. Both `emit` built-ins — the click one and the hover
 * one — run this exact seam so the security boundary has a single definition.
 *
 * @remarks
 * The two built-ins differ only in *when* and *how often* they call this: the
 * click one on every click, the hover one once per feature entered (its own
 * per-feature dedupe wraps this call). Neither forks the trust gate or the
 * closed-world resolution — both live here.
 *
 * - **Trust gate first.** The host-hook seam is default-deny outside a trusted
 *   context, so an untrusted document that names an event finds emit inert. A
 *   missing policy falls back to {@link DEFAULT_POLICY} (untrusted) — absent
 *   means denied, never open.
 * - **Closed-world resolution.** Own registered keys only: an unknown name — or
 *   a prototype method like `toString` — resolves to nothing and is denied with
 *   a warning, never dispatched.
 */
function dispatchEmit(
  config: EmitConfig,
  ctx: InteractionContext,
  deps: InteractionDeps
): void {
  if (!allowsHostHook(deps.policy ?? DEFAULT_POLICY)) return;

  const handlers = deps.hostHandlers;
  const handler =
    handlers && Object.prototype.hasOwnProperty.call(handlers, config.event)
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

  const properties = (ctx.feature?.properties ?? {}) as Record<string, unknown>;
  handler(projectEmitPayload(config.payload, properties));
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
  // NOTE (emit dispatch surface): emit dispatches wherever its deps carry a
  // trusted `policy` and a `hostHandlers` map — now both binding paths, since
  // they share one core (`bindLayerInteractions`) and both build the
  // `showPopup`/`hostHandlers`/`policy` deps the same way (ml-wx2 / R9). Under
  // the live `<ml-map>` renderer emit is *capable* but still *inert* in practice:
  // `MapRenderer` supplies the default untrusted policy and no `hostHandlers`, so
  // the trust gate below denies every event — fail-closed by default. Lighting
  // it up under `<ml-map>` (an embedder trust surface + a DOM-event bridge that
  // supplies `hostHandlers`) is the deferred follow-up bead; nothing here needs
  // to change for it.
  defineInteraction<EmitConfig>({
    name: "emit",
    select: (trigger) => trigger.emit,
    // The click emit: dispatch on every click, no dedupe. The trust gate and
    // closed-world resolution live in the shared `dispatchEmit` seam.
    create: stateless((config: EmitConfig, ctx, deps) =>
      dispatchEmit(config, ctx, deps)
    ),
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
  // The hover emit (ml-fn9): the SAME logical `emit` interaction as the click
  // built-in — same name, same trust gate, same closed-world resolution (both
  // run the shared `dispatchEmit`) — but driven by `mousemove` and wrapped in
  // per-feature dedupe. It fires once when a NEW feature is entered and stays
  // inert on every further mousemove over that same feature, mirroring the
  // `lit`-map guard `highlight` uses above. The registry allows the shared name
  // "emit" across the click and hover trigger lists (see InteractionRegistry).
  defineInteraction<EmitConfig>({
    name: "emit",
    select: (trigger) => trigger.emit,
    create: (deps) => {
      /** The feature last emitted per layer — per handler instance, never shared. */
      const lastEmitted = new Map<string, string | number>();
      /** Warn once per layer about missing ids, not once per mousemove. */
      const warned = new Set<string>();

      return {
        run(config: EmitConfig, ctx) {
          const featureId = ctx.feature?.id;

          if (featureId === undefined || featureId === null) {
            // Dedupe is addressed by feature id; without one a re-entered feature
            // is indistinguishable from a new one, so emit would fire on every
            // mousemove — the firehose this dedupe exists to prevent. Skip, and
            // point the author at the same remedy `highlight` uses.
            if (!warned.has(ctx.layerId)) {
              warned.add(ctx.layerId);
              console.warn(
                `[maplibre-yaml] hover.emit on layer "${ctx.layerId}" needs ` +
                  "feature ids to dedupe. Set `generateId: true` on the source, " +
                  "or `promoteId` to use a property as the id."
              );
            }
            return;
          }

          // Same feature since the last dispatch → no churn, mirroring
          // highlight's `current?.featureId === featureId` guard. Marking the
          // feature entered before dispatch means a denied/inert emit (untrusted
          // policy, unknown event) is not retried — and does not re-warn — on
          // every further mousemove over the same feature.
          if (lastEmitted.get(ctx.layerId) === featureId) return;
          lastEmitted.set(ctx.layerId, featureId);

          dispatchEmit(config, ctx, deps);
        },

        clearLayer(layerId) {
          // mouseleave/detach/destroy: forget the tracked feature so re-entering
          // it emits again — the same lifecycle highlight clears its state on.
          lastEmitted.delete(layerId);
        },
      };
    },
  }),
  // The hover popup (U7/R10, KTD8): the same logical `popup` interaction as
  // the click built-in — same content schema, same PopupBuilder trust gate,
  // reached through the same `showPopup` dep — but driven by `mousemove` with
  // per-feature dedupe, shown chromeless (`closeButton: false`), and
  // dismissed on leave via the `hidePopup` dep. Coexistence and the touch
  // posture both fall out of the seams rather than local logic here: the
  // host's one-popup slot means a pinned click popup suppresses hover popups
  // until dismissed (see ShowPopupOptions.kind), and MapLibre never fires
  // layer `mousemove` for touch input, so tap routes to `click.popup` and
  // hover popups simply do not exist on touch.
  defineInteraction<PopupContent>({
    name: "popup",
    select: (trigger) => trigger.popup,
    create: (deps) => {
      /** The feature last shown per layer — per handler instance, never shared. */
      const lastShown = new Map<string, string | number>();
      /** Warn once per layer about the id-less fallback, not per mousemove. */
      const warned = new Set<string>();

      /**
       * Dedupe key. Unlike highlight (which NEEDS ids — feature-state is
       * addressed by them), a popup can fall back to keying on the feature's
       * geometry when ids are missing: approximate, but it keeps id-less
       * sources working instead of dead. Warn once so authors know the fix.
       */
      const keyFor = (ctx: { feature?: any; layerId: string }): string | number | null => {
        const id = ctx.feature?.id;
        if (id !== undefined && id !== null) return id;
        const coordinates = ctx.feature?.geometry?.coordinates;
        if (coordinates === undefined) return null;
        if (!warned.has(ctx.layerId)) {
          warned.add(ctx.layerId);
          console.warn(
            `[maplibre-yaml] hover.popup on layer "${ctx.layerId}" is deduping ` +
              "by feature geometry because features have no ids — set " +
              "`generateId: true` on the source, or `promoteId`, for exact tracking."
          );
        }
        return JSON.stringify(coordinates);
      };

      return {
        run(content: PopupContent, ctx) {
          const key = keyFor(ctx);
          if (key === null) return;
          if (lastShown.get(ctx.layerId) === key) return; // same feature, no churn
          lastShown.set(ctx.layerId, key);

          deps.showPopup(content, ctx.feature, ctx.lngLat, {
            closeButton: false,
            closeOnClick: false,
            kind: "hover",
          });
        },

        clearLayer(layerId) {
          // mouseleave/detach/destroy: drop the popup and the tracked feature
          // so re-entering shows it again.
          lastShown.delete(layerId);
          deps.hidePopup?.();
        },
      };
    },
  }),
];
