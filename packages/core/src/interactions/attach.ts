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

import type { Map as MapLibreMap, MapMouseEvent, LngLat } from "maplibre-gl";
import { PopupBuilder, mapLanguage } from "../renderer/popup-builder";
import { PopupSlot } from "./popup-slot";
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
 * Optional raw-event callback hook lent to the shared per-layer bind core.
 *
 * @remarks
 * Independent of interaction dispatch: `onClick`/`onHover` fire on every
 * click/mouseenter *after* the `select`-ordered dispatch has run, carrying the
 * topmost `(layerId, feature, lngLat)`. Opt-in — the compiled/host path
 * ({@link attachInteractions} with no callbacks) supplies none, so nothing new
 * fires and behavior is byte-identical. The renderer's `EventHandler` supplies
 * its `onClick`/`onHover` here so both binding paths share one implementation.
 */
export interface LayerInteractionCallbacks {
  onClick?: (layerId: string, feature: any, lngLat: LngLat) => void;
  onHover?: (layerId: string, feature: any, lngLat: LngLat) => void;
}

/**
 * The per-attach-session state {@link bindLayerInteractions} threads across
 * layers.
 *
 * @remarks
 * Built once by the caller and passed to every per-layer bind so state that
 * must be shared across layers — the `boundHandlers` map `detach`/`destroy`
 * drive, and the pre-built interaction runtimes (`highlight` tracks its lit
 * feature per layerId across layers) — is not recreated per layer. The popup
 * lifecycle (`PopupBuilder`/`PopupSlot`) is not here: it is absorbed into the
 * bound interactions' `showPopup` dep by the caller, so the core never touches
 * it directly.
 */
export interface LayerBindDeps {
  /** The registry, for closed-world validation of projected trigger keys. */
  registry: InteractionRegistry;
  /** Click interactions bound once per attach session, in registry order. */
  clickInteractions: BoundInteraction[];
  /** Hover interactions bound once per attach session, in registry order. */
  hoverInteractions: BoundInteraction[];
  /** Listener functions per layer, so `detach`/`destroy` can `map.off` each. */
  boundHandlers: Map<string, BoundLayerHandlers>;
  /** Optional raw-event callback hook (KD2); absent on the compiled path. */
  callbacks?: LayerInteractionCallbacks;
}

/** Run every configured interaction for a trigger, in registry order. */
function dispatch(
  interactions: BoundInteraction[],
  trigger: any,
  ctx: InteractionContext
): void {
  for (const { interaction, runtime } of interactions) {
    const config = interaction.select(trigger);
    // Falsy means not configured (or present-but-off, e.g. `highlight: false`).
    if (!config) continue;
    runtime.run(config, ctx);
  }
}

/** Whether any hover interaction is configured for this trigger. */
function hasHoverInteraction(
  hoverInteractions: BoundInteraction[],
  hover: any
): boolean {
  return hoverInteractions.some(({ interaction }) => !!interaction.select(hover));
}

/** Release per-layer interaction state (mouseleave, detach, destroy, reset). */
export function clearInteractionState(
  map: MapLibreMap,
  clickInteractions: BoundInteraction[],
  hoverInteractions: BoundInteraction[],
  layerId: string
): void {
  for (const { runtime } of hoverInteractions) runtime.clearLayer?.(layerId, map);
  for (const { runtime } of clickInteractions) runtime.clearLayer?.(layerId, map);
}

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
function validateTrigger(
  registry: InteractionRegistry,
  trigger: any,
  reserved: Set<string>,
  layerId: string
): void {
  if (!trigger || typeof trigger !== "object") return;
  for (const key of Object.keys(trigger)) {
    if (reserved.has(key)) continue;
    if (registry.has(key)) continue;
    const result = registry.resolve(key);
    if ("denied" in result) {
      console.warn(`[maplibre-yaml] ${result.warning} (layer "${layerId}")`);
    }
  }
}

/**
 * The listeners bound for one layer, as `boundHandlers` records them.
 *
 * @remarks
 * Delegated listeners (`map.on(event, layerId, fn)`) sit under their event
 * name; a `tolerance` binds map-level listeners (`map.on(event, fn)`) instead,
 * recorded under `map` so {@link unbindLayerInteractions} removes each with
 * the `off` form it was bound with.
 */
export interface BoundLayerHandlers {
  click?: any;
  mouseenter?: any;
  mouseleave?: any;
  mousemove?: any;
  map?: Record<string, any>;
}

/** `map.off` every listener {@link bindLayerInteractions} bound for a layer. */
export function unbindLayerInteractions(
  map: MapLibreMap,
  layerId: string,
  handlers: BoundLayerHandlers
): void {
  for (const [event, fn] of Object.entries(handlers) as [string, any][]) {
    if (event === "map") {
      for (const [ev, f] of Object.entries(fn) as [string, any][]) map.off(ev as any, f);
    } else {
      map.off(event as any, layerId, fn);
    }
  }
}

/**
 * Bind click / hover / mousemove listeners for one projected layer — the shared
 * per-layer bind core (KD1).
 *
 * @remarks
 * SHARED CORE — the single copy of the `map.on` binding, `select`-ordered
 * dispatch, cursor handling, and raw-event callback hook. {@link
 * attachInteractions} calls it all-at-once (looping a fully-projected
 * `InteractionsProjection`); the renderer's `EventHandler` calls it
 * incrementally per raw layer. Both thread their per-session state in via
 * {@link LayerBindDeps}, so the binding never drifts between them. The parity
 * test in `tests/interactions/attach.test.ts` guards the bound-listener set
 * across several configs.
 *
 * The `mouseenter` handler receives the event so the optional `onHover`
 * callback can read `e.features?.[0]` — matching `EventHandler`'s timing and
 * arguments. When `deps.callbacks` is absent (the compiled path) nothing extra
 * fires and the binding is byte-identical to the pre-extraction closure.
 *
 * A trigger's `tolerance` (pixels, > 0) swaps MapLibre's delegated layer
 * event — which fires only on a rendered pixel of a feature — for a map-level
 * listener that hit-tests a ±tolerance box restricted to the layer
 * (`queryRenderedFeatures`), so thin lines and small points are easier to
 * hit. Dispatch is the same code either way; only the listener differs.
 *
 * @param map - The map to bind listeners on.
 * @param layerId - The layer these listeners target.
 * @param entry - The projected `{ source, interactive }` for this layer.
 * @param deps - Per-attach-session state (see {@link LayerBindDeps}).
 */
export function bindLayerInteractions(
  map: MapLibreMap,
  layerId: string,
  entry: ProjectedLayerInteractions,
  deps: LayerBindDeps
): void {
  const { registry, clickInteractions, hoverInteractions, boundHandlers, callbacks } =
    deps;

  const interactive = entry.interactive ?? {};
  const sourceId = entry.source;
  const hover = (interactive as any).hover;
  const click = (interactive as any).click;

  validateTrigger(registry, click, RESERVED_CLICK_KEYS, layerId);
  validateTrigger(registry, hover, RESERVED_HOVER_KEYS, layerId);

  // Delegated listeners keyed by event; map-level ones (a `tolerance`) under
  // `map`, so `unbindLayerInteractions` knows which `off` form each needs.
  const handlers: BoundLayerHandlers = {};
  const ctx = (feature: any, lngLat: LngLat): InteractionContext => ({
    map,
    layerId,
    sourceId,
    feature,
    lngLat,
  });
  // The tolerant hit test: the topmost feature of this layer within ±n px of
  // the pointer — the same "first result" the delegated path reads from
  // `e.features[0]`, so a multi-feature hit resolves identically. Skipped
  // while the layer is not on the map (a host removed it, or a style swap is
  // mid-flight): MapLibre's own delegated listeners filter by getLayer the
  // same way, and querying a missing layer id fires a map error per event.
  const hit = (e: MapMouseEvent, n: number) =>
    map.getLayer(layerId)
      ? map.queryRenderedFeatures(
          [
            [e.point.x - n, e.point.y - n],
            [e.point.x + n, e.point.y + n],
          ],
          { layers: [layerId] }
        )[0]
      : undefined;

  if (hover) {
    const enter = (feature: any, lngLat: LngLat) => {
      if (hover.cursor) map.getCanvas().style.cursor = hover.cursor;
      if (feature) callbacks?.onHover?.(layerId, feature, lngLat);
    };
    const leave = () => {
      map.getCanvas().style.cursor = "";
      clearInteractionState(map, clickInteractions, hoverInteractions, layerId);
    };
    // mousemove only when a hover interaction needs per-feature resolution —
    // mouseenter fires once for the layer, not once per feature.
    const perFeature = hasHoverInteraction(hoverInteractions, hover);
    const move = (feature: any, lngLat: LngLat) =>
      dispatch(hoverInteractions, hover, ctx(feature, lngLat));
    const n = hover.tolerance;

    if (n > 0) {
      // Emulate enter/leave from a map-level mousemove: the first hit enters,
      // every hit moves (the runtimes dedupe per feature, as on the delegated
      // path), the first miss — or the pointer leaving the canvas — leaves.
      let over = false;
      const out = () => {
        if (over) {
          over = false;
          leave();
        }
      };
      const mousemove = (e: MapMouseEvent) => {
        const feature = hit(e, n);
        if (!feature) return out();
        if (!over) {
          over = true;
          enter(feature, e.lngLat);
        }
        if (perFeature) move(feature, e.lngLat);
      };
      handlers.map = { mousemove, mouseout: out };
      map.on("mousemove", mousemove);
      map.on("mouseout", out);
    } else {
      handlers.mouseenter = (e: MapMouseEvent & { features?: any[] }) =>
        enter(e.features?.[0], e.lngLat);
      handlers.mouseleave = leave;
      map.on("mouseenter", layerId, handlers.mouseenter);
      map.on("mouseleave", layerId, handlers.mouseleave);
      if (perFeature) {
        handlers.mousemove = (e: MapMouseEvent & { features?: any[] }) => {
          const feature = e.features?.[0];
          if (feature) move(feature, e.lngLat);
        };
        map.on("mousemove", layerId, handlers.mousemove);
      }
    }
  }

  if (click) {
    const pick = (feature: any, lngLat: LngLat) => {
      dispatch(clickInteractions, click, ctx(feature, lngLat));
      // Raw-event hook fires AFTER dispatch so interaction handlers run first.
      callbacks?.onClick?.(layerId, feature, lngLat);
    };
    const n = click.tolerance;

    if (n > 0) {
      const mapClick = (e: MapMouseEvent) => {
        const feature = hit(e, n);
        if (feature) pick(feature, e.lngLat);
      };
      (handlers.map ??= {}).click = mapClick;
      map.on("click", mapClick);
    } else {
      handlers.click = (e: MapMouseEvent & { features?: any[] }) => {
        // Multi-feature clicks resolve to the topmost feature, matching hover.
        const feature = e.features?.[0];
        if (feature) pick(feature, e.lngLat);
      };
      map.on("click", layerId, handlers.click);
    }
  }

  boundHandlers.set(layerId, handlers);
}

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
  // so `!html` and feature escaping apply exactly as in the renderer. The
  // pinned/hover coexistence contract lives in PopupSlot (KTD8), shared with
  // the renderer host.
  const popupSlot = new PopupSlot(map, new PopupBuilder(policy, { language: mapLanguage(map) }));

  const deps: InteractionDeps = {
    showPopup: (content, feature, lngLat, options) =>
      popupSlot.show(content, feature, lngLat, options),
    hidePopup: () => popupSlot.hideHover(),
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
  const boundHandlers = new Map<string, BoundLayerHandlers>();

  // The per-session state the shared core threads across layers. The compiled
  // path supplies no `callbacks`, so binding is byte-identical to the pre-
  // extraction closure — the opt-in hook stays dormant here.
  const bindDeps: LayerBindDeps = {
    registry,
    clickInteractions,
    hoverInteractions,
    boundHandlers,
  };

  const detach = (layerId: string): void => {
    const handlers = boundHandlers.get(layerId);
    if (!handlers) return;

    unbindLayerInteractions(map, layerId, handlers);

    // Before forgetting the layer: a feature left lit here would stay lit.
    clearInteractionState(map, clickInteractions, hoverInteractions, layerId);
    boundHandlers.delete(layerId);
  };

  const destroy = (): void => {
    for (const layerId of [...boundHandlers.keys()]) detach(layerId);
    popupSlot.destroy();
  };

  // Wire every projected layer through the shared per-layer bind core.
  for (const [layerId, entry] of Object.entries(projection.layers)) {
    bindLayerInteractions(map, layerId, entry, bindDeps);
  }

  return {
    resetFeatureState: (layerId: string) =>
      clearInteractionState(map, clickInteractions, hoverInteractions, layerId),
    detach,
    destroy,
  };
}
