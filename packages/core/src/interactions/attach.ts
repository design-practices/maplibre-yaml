/**
 * @file Attach a declarative interactions projection onto a host-owned map
 * @module @maplibre-yaml/core/interactions
 *
 * @description
 * `attachInteractions` is the compiled-map + bring-your-own-map entry point: it
 * wires the registry's built-in handlers onto a `maplibregl.Map` a host already
 * owns (or a bare `new maplibregl.Map({ style })`), driven only by the
 * declarative projection {@link projectInteractions} produces. It reproduces
 * `EventHandler.attachLayer`'s `map.on` binding — click / mouseenter /
 * mouseleave / mousemove per layer, dispatched through each interaction's
 * `select` in registry order — but with no dependence on `<ml-map>` or the
 * renderer's internals.
 *
 * **The load-bearing security requirement lives here.** The popup built-in
 * renders `!html` markers, and the gate that decides live-markup-vs-escaped is
 * the renderer's `PopupBuilder(policy)`. Because `attachInteractions` runs
 * *outside* the renderer, it constructs its own `PopupBuilder(policy)` and
 * routes the popup sink through it — otherwise a compiled-map popup would render
 * untrusted `!html` and feature data as live markup with no gate, an XSS hole on
 * exactly the bare-`Map` path this entry point adds. An absent policy defaults
 * to {@link DEFAULT_POLICY} (untrusted), so a forgotten policy escapes `!html`
 * and denies host hooks rather than opening both.
 */

import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { Popup } from "../renderer/maplibre-interop";
import { PopupBuilder } from "../renderer/popup-builder";
import { DEFAULT_POLICY, type CapabilityPolicy } from "../capabilities";
import {
  InteractionRegistry,
  createInteractionRegistry,
} from "./registry";
import type {
  Interaction,
  InteractionContext,
  InteractionDeps,
  InteractionRuntime,
  InteractionHostHandlers,
} from "./types";
import type {
  InteractionsProjection,
  ProjectedLayerInteractions,
} from "./manifest";

/** An interaction paired with its per-attach runtime. */
interface BoundInteraction {
  interaction: Interaction;
  runtime: InteractionRuntime;
}

/**
 * Options for {@link attachInteractions}.
 */
export interface AttachInteractionsOptions {
  /**
   * The interaction registry resolving names to built-ins. Defaults to a fresh
   * {@link createInteractionRegistry} — each attach gets its own, mirroring the
   * renderer's non-singleton posture.
   */
  registry?: InteractionRegistry;
  /**
   * The host handler map the `emit` interaction resolves event names against,
   * closed-world. Absent means every `emit` resolves to a denial.
   */
  hostHandlers?: InteractionHostHandlers;
  /**
   * The capability policy in force. Gates the popup `!html` marker and the
   * `emit` host hook. Defaults to {@link DEFAULT_POLICY} (untrusted) — an absent
   * policy escapes `!html` and denies hooks rather than opening them.
   */
  policy?: CapabilityPolicy;
}

/**
 * The lifecycle handle {@link attachInteractions} returns.
 *
 * @remarks
 * The real `EventHandler` couplings, exposed for a host to drive: a live-data
 * host calls `resetFeatureState` after a refresh replaces a layer's data (stale
 * feature ids address different features); `detach` releases one layer; and
 * `destroy` releases everything with no listener left bound. A compiled host
 * that never refreshes simply never calls `resetFeatureState`.
 */
export interface InteractionsHandle {
  /** Drop highlight/hover feature-state for a layer whose data was replaced. */
  resetFeatureState(layerId: string): void;
  /** Detach every listener bound for one layer, and clear its state. */
  detach(layerId: string): void;
  /** Detach every layer and remove any open popup. */
  destroy(): void;
}

/** Trigger keys that are not interaction names (handled directly, not denied). */
const RESERVED_CLICK_KEYS = new Set(["action"]);
const RESERVED_HOVER_KEYS = new Set(["cursor"]);

/**
 * Wire a declarative interactions projection onto a host-owned or compiled map.
 *
 * @param map - Any `maplibregl.Map` the host owns; no `<ml-map>` needed.
 * @param projection - The declarative projection from {@link projectInteractions}.
 * @param options - Registry, host handler map, and capability policy.
 * @returns A lifecycle handle exposing `resetFeatureState`/`detach`/`destroy`.
 */
export function attachInteractions(
  map: MapLibreMap,
  projection: InteractionsProjection,
  options: AttachInteractionsOptions = {}
): InteractionsHandle {
  const {
    registry = createInteractionRegistry(),
    hostHandlers,
    policy = DEFAULT_POLICY,
  } = options;

  // The compiled-path XSS gate: the popup sink runs through PopupBuilder(policy)
  // so `!html` and feature escaping apply exactly as in the renderer.
  const popupBuilder = new PopupBuilder(policy);
  let activePopup: Popup | null = null;

  const deps: InteractionDeps = {
    showPopup: (content, feature, lngLat) => {
      activePopup?.remove();
      const html = popupBuilder.build(content, feature?.properties ?? {});
      activePopup = new Popup().setLngLat(lngLat).setHTML(html).addTo(map);
    },
    hostHandlers,
    policy,
  };

  // One runtime per interaction per attach call — shared across layers exactly
  // as EventHandler binds them once per instance. highlight tracks its lit
  // feature per layerId, so sharing across layers never leaks state.
  const bind = (interactions: readonly Interaction[]): BoundInteraction[] =>
    interactions.map((interaction) => ({
      interaction,
      runtime: interaction.create(deps),
    }));
  const clickInteractions = bind(registry.clickInteractions());
  const hoverInteractions = bind(registry.hoverInteractions());

  // Handlers bound per layer, so detach/destroy can `map.off` each with no leak.
  const boundHandlers = new Map<string, any>();

  /** Run every configured interaction for a trigger, in registry order. */
  const dispatch = (
    interactions: BoundInteraction[],
    trigger: any,
    ctx: InteractionContext
  ): void => {
    for (const { interaction, runtime } of interactions) {
      const config = interaction.select(trigger);
      // Falsy means not configured (or present-but-off, e.g. `highlight: false`).
      if (!config) continue;
      runtime.run(config, ctx);
    }
  };

  /** Whether any hover interaction is configured for this trigger. */
  const hasHoverInteraction = (hover: any): boolean =>
    hoverInteractions.some(({ interaction }) => !!interaction.select(hover));

  /** Release per-layer interaction state (mouseleave, detach, destroy, reset). */
  const clearInteractionState = (layerId: string): void => {
    for (const { runtime } of hoverInteractions) runtime.clearLayer?.(layerId, map);
    for (const { runtime } of clickInteractions) runtime.clearLayer?.(layerId, map);
  };

  /**
   * Closed-world validation of a projected trigger against the registry.
   *
   * @remarks
   * A trigger key that names no built-in interaction — and is not a recognized
   * non-interaction key (`cursor`, `action`) — is denied with a warning and
   * dispatches nothing (AE4). This is defense-in-depth on the attach boundary:
   * a hand-built or tampered projection naming an unknown interaction is dropped
   * rather than silently ignored.
   */
  const validateTrigger = (
    trigger: any,
    reserved: Set<string>,
    layerId: string
  ): void => {
    if (!trigger || typeof trigger !== "object") return;
    for (const key of Object.keys(trigger)) {
      if (reserved.has(key)) continue;
      if (registry.has(key)) continue;
      const result = registry.resolve(key);
      if ("denied" in result) {
        console.warn(`[maplibre-yaml] ${result.warning} (layer "${layerId}")`);
      }
    }
  };

  /**
   * Bind listeners for one projected layer.
   *
   * @remarks
   * PARALLEL IMPLEMENTATION — keep in sync with `EventHandler.attachEvents`
   * (`renderer/event-handler.ts`). R9 is deferred, so the `map.on` binding +
   * `select`-ordered dispatch logic lives in two live copies: this one (driven
   * by a declarative projection, no `<ml-map>`) and the renderer's (driven by a
   * raw v1 layer). Any change to which listeners are bound, in what order they
   * dispatch, or how the context is built must land in BOTH until R9 converges
   * them. The parity test in `tests/interactions/attach.test.ts` guards the
   * bound-listener set across several configs; it is the drift alarm.
   */
  const attachLayer = (
    layerId: string,
    entry: ProjectedLayerInteractions
  ): void => {
    const interactive = entry.interactive ?? {};
    const sourceId = entry.source;
    const hover = (interactive as any).hover;
    const click = (interactive as any).click;

    validateTrigger(click, RESERVED_CLICK_KEYS, layerId);
    validateTrigger(hover, RESERVED_HOVER_KEYS, layerId);

    const handlers: any = {};

    if (hover) {
      handlers.mouseenter = () => {
        if (hover.cursor) map.getCanvas().style.cursor = hover.cursor;
      };
      handlers.mouseleave = () => {
        map.getCanvas().style.cursor = "";
        clearInteractionState(layerId);
      };
      map.on("mouseenter", layerId, handlers.mouseenter);
      map.on("mouseleave", layerId, handlers.mouseleave);

      // mousemove only when a hover interaction needs per-feature resolution —
      // mouseenter fires once for the layer, not once per feature.
      if (hasHoverInteraction(hover)) {
        handlers.mousemove = (e: MapMouseEvent & { features?: any[] }) => {
          const feature = e.features?.[0];
          if (!feature) return;
          dispatch(hoverInteractions, hover, {
            map,
            layerId,
            sourceId,
            feature,
            lngLat: e.lngLat,
          });
        };
        map.on("mousemove", layerId, handlers.mousemove);
      }
    }

    if (click) {
      handlers.click = (e: MapMouseEvent & { features?: any[] }) => {
        // Multi-feature clicks resolve to the topmost feature, matching hover.
        const feature = e.features?.[0];
        if (!feature) return;
        dispatch(clickInteractions, click, {
          map,
          layerId,
          sourceId,
          feature,
          lngLat: e.lngLat,
        });
      };
      map.on("click", layerId, handlers.click);
    }

    boundHandlers.set(layerId, handlers);
  };

  const detach = (layerId: string): void => {
    const handlers = boundHandlers.get(layerId);
    if (!handlers) return;

    if (handlers.click) map.off("click", layerId, handlers.click);
    if (handlers.mouseenter) map.off("mouseenter", layerId, handlers.mouseenter);
    if (handlers.mouseleave) map.off("mouseleave", layerId, handlers.mouseleave);
    if (handlers.mousemove) map.off("mousemove", layerId, handlers.mousemove);

    // Before forgetting the layer: a feature left lit here would stay lit.
    clearInteractionState(layerId);
    boundHandlers.delete(layerId);
  };

  const destroy = (): void => {
    for (const layerId of [...boundHandlers.keys()]) detach(layerId);
    activePopup?.remove();
    activePopup = null;
  };

  // Wire every projected layer.
  for (const [layerId, entry] of Object.entries(projection.layers)) {
    attachLayer(layerId, entry);
  }

  return {
    resetFeatureState: (layerId: string) => clearInteractionState(layerId),
    detach,
    destroy,
  };
}
