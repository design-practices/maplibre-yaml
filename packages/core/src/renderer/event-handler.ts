/**
 * @file Event handler for map layer interactions
 * @module @maplibre-yaml/core/renderer
 */

import type { Map as MapLibreMap, LngLat } from "maplibre-gl";
import { Popup } from "./maplibre-interop";
import type { z } from "zod";
import { LayerSchema, PopupContentSchema } from "../schemas";
import { PopupBuilder } from "./popup-builder";
import type { CapabilityPolicy } from "../capabilities";
import {
  createInteractionRegistry,
  type InteractionRegistry,
  type Interaction,
  type InteractionDeps,
  type InteractionRuntime,
  type InteractionHostHandlers,
} from "../interactions";
import {
  bindLayerInteractions,
  clearInteractionState,
  type LayerBindDeps,
} from "../interactions/attach";
import type { ProjectedLayerInteractions } from "../interactions/manifest";

/** An interaction paired with its per-handler runtime. */
type BoundInteraction = {
  interaction: Interaction;
  runtime: InteractionRuntime;
};

type Layer = z.infer<typeof LayerSchema>;
type PopupContent = z.infer<typeof PopupContentSchema>;

/**
 * Callbacks for interactive events
 */
export interface EventHandlerCallbacks {
  onClick?: (layerId: string, feature: any, lngLat: LngLat) => void;
  onHover?: (layerId: string, feature: any, lngLat: LngLat) => void;
}

export type {
  Interaction,
  InteractionContext,
  InteractionDeps,
} from "../interactions";

/**
 * Handles click, hover, and other interactive events on layers.
 *
 * @remarks
 * The per-layer `map.on` binding, `select`-ordered dispatch, cursor handling,
 * and raw-event callback hook live in ONE shared core —
 * {@link bindLayerInteractions} in `interactions/attach.ts`. `EventHandler`
 * drives it incrementally (once per raw v1 layer as `MapRenderer.addLayer`
 * adds them); `attachInteractions` drives the same core all-at-once from a
 * declarative projection. There is no second copy to keep in sync.
 *
 * The popup lifecycle stays caller-side (this class owns its `PopupBuilder`
 * and `activePopup`, threaded into the core via `interactionDeps.showPopup`),
 * exactly as `attachInteractions` does.
 */
export class EventHandler {
  private map: MapLibreMap;
  private callbacks: EventHandlerCallbacks;
  private popupBuilder: PopupBuilder;
  private activePopup: Popup | null;
  private attachedLayers: Set<string>;
  private boundHandlers: Map<string, any>;
  private registry: InteractionRegistry;
  private interactionDeps: InteractionDeps;
  private clickInteractions: BoundInteraction[];
  private hoverInteractions: BoundInteraction[];
  /** Per-session state threaded into every per-layer bind (see the core). */
  private bindDeps: LayerBindDeps;

  constructor(
    map: MapLibreMap,
    callbacks?: EventHandlerCallbacks,
    policy?: CapabilityPolicy,
    hostHandlers?: InteractionHostHandlers
  ) {
    this.map = map;
    this.callbacks = callbacks || {};
    this.popupBuilder = new PopupBuilder(policy);
    this.activePopup = null;
    this.attachedLayers = new Set();
    this.boundHandlers = new Map();
    this.registry = createInteractionRegistry();

    // Bound late so interactions reach the live method (and any test spy on it)
    // rather than a copy captured at construction. Policy + hostHandlers are
    // threaded so the `emit` built-in's trust gate is honored on the shared
    // path: trusted + registered handler dispatches, trusted + no handler
    // warns, untrusted (the default, and the only thing `MapRenderer`/`<ml-map>`
    // supplies today) denies silently. `MapRenderer` passes no `hostHandlers`,
    // so `click.emit` stays inert under `<ml-map>` — fail-closed by default.
    this.interactionDeps = {
      showPopup: (content, feature, lngLat) =>
        this.showPopup(content, feature, lngLat),
      hostHandlers,
      policy,
    };

    // One runtime per interaction per handler, so stateful interactions
    // (highlight) never share tracked features across map instances. Built from
    // the registry so the shared core has the registry for closed-world
    // validation and the same ordered sets it iterates.
    const bind = (interactions: readonly Interaction[]): BoundInteraction[] =>
      interactions.map((interaction) => ({
        interaction,
        runtime: interaction.create(this.interactionDeps),
      }));
    this.clickInteractions = bind(this.registry.clickInteractions());
    this.hoverInteractions = bind(this.registry.hoverInteractions());

    this.bindDeps = {
      registry: this.registry,
      clickInteractions: this.clickInteractions,
      hoverInteractions: this.hoverInteractions,
      boundHandlers: this.boundHandlers,
      callbacks: this.callbacks,
    };
  }

  /**
   * Attach events for a layer based on its interactive config.
   *
   * @remarks
   * Converts the raw v1 `Layer` to the projected `{ source, interactive }`
   * entry the shared core expects (KD5) and delegates all binding to it. The
   * source id is derived exactly as `LayerManager` derives it, so feature-state
   * writes address the source the data actually lives in. This deliberately
   * does NOT route through `projectInteractions` — that drops `emit` under an
   * untrusted policy at projection time, which would strip emit before the
   * runtime trust gate rather than exercising it.
   */
  attachEvents(layer: Layer): void {
    if (!layer.interactive) return;

    // Source id, derived exactly as LayerManager derives it: a string source is
    // a named reference; an inline source object is backed by `${id}-source`.
    const source =
      typeof layer.source === "string" ? layer.source : `${layer.id}-source`;

    const entry: ProjectedLayerInteractions = {
      source,
      interactive: layer.interactive as ProjectedLayerInteractions["interactive"],
    };

    bindLayerInteractions(this.map, layer.id, entry, this.bindDeps);
    this.attachedLayers.add(layer.id);
  }

  /**
   * Drop highlight state for a layer whose data was replaced.
   *
   * @remarks
   * Feature ids are only meaningful within a given dataset — after a refresh
   * `setData`, a retained id can address a different feature entirely.
   * Delegates to the shared core's per-layer feature-state clear.
   */
  resetFeatureState(layerId: string): void {
    clearInteractionState(
      this.map,
      this.clickInteractions,
      this.hoverInteractions,
      layerId
    );
  }

  /**
   * Show a popup with content.
   *
   * @remarks
   * Caller-side popup lifecycle: the shared core never touches the popup
   * directly — it is absorbed into `interactionDeps.showPopup`, mirroring
   * `attachInteractions`. The single `PopupBuilder(policy)` gates `!html`.
   */
  private showPopup(content: PopupContent, feature: any, lngLat: LngLat): void {
    this.activePopup?.remove();

    const html = this.popupBuilder.build(content, feature.properties);

    this.activePopup = new Popup()
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(this.map);
  }

  /**
   * Detach events for a layer.
   *
   * @remarks
   * Mirrors `attachInteractions`'s `detach`: `map.off` each listener the shared
   * core bound (recorded in `boundHandlers`), then clear the layer's
   * feature-state so a feature left lit here does not stay lit.
   */
  detachEvents(layerId: string): void {
    const handlers = this.boundHandlers.get(layerId);
    if (!handlers) return;

    if (handlers.click) {
      this.map.off("click", layerId, handlers.click as any);
    }
    if (handlers.mouseenter) {
      this.map.off("mouseenter", layerId, handlers.mouseenter as any);
    }
    if (handlers.mouseleave) {
      this.map.off("mouseleave", layerId, handlers.mouseleave as any);
    }
    if (handlers.mousemove) {
      this.map.off("mousemove", layerId, handlers.mousemove as any);
    }

    // Before forgetting the layer: a feature left lit here would stay lit.
    clearInteractionState(
      this.map,
      this.clickInteractions,
      this.hoverInteractions,
      layerId
    );

    this.boundHandlers.delete(layerId);
    this.attachedLayers.delete(layerId);
  }

  /**
   * Clean up all event handlers
   */
  destroy(): void {
    for (const layerId of this.attachedLayers) {
      this.detachEvents(layerId);
    }
    this.activePopup?.remove();
    this.activePopup = null;
  }
}
