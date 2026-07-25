/**
 * @file Event handler for map layer interactions
 * @module @maplibre-yaml/core/renderer
 */

import type { Map as MapLibreMap, MapMouseEvent, LngLat } from "maplibre-gl";
import { Popup } from "./maplibre-interop";
import type { z } from "zod";
import { LayerSchema, PopupContentSchema } from "../schemas";
import { PopupBuilder } from "./popup-builder";
import {
  CLICK_INTERACTIONS,
  HOVER_INTERACTIONS,
  type Interaction,
  type InteractionContext,
  type InteractionDeps,
  type InteractionRuntime,
} from "./interactions";

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
} from "./interactions";

/**
 * Handles click, hover, and other interactive events on layers
 */
export class EventHandler {
  private map: MapLibreMap;
  private callbacks: EventHandlerCallbacks;
  private popupBuilder: PopupBuilder;
  private activePopup: Popup | null;
  private attachedLayers: Set<string>;
  private boundHandlers: Map<
    string,
    {
      click?: Function;
      mouseenter?: Function;
      mouseleave?: Function;
      mousemove?: Function;
    }
  >;
  private interactionDeps: InteractionDeps;
  private clickInteractions: BoundInteraction[];
  private hoverInteractions: BoundInteraction[];
  /** Source id per layer, derived as LayerManager derives it. */
  private layerToSource: Map<string, string>;

  constructor(map: MapLibreMap, callbacks?: EventHandlerCallbacks) {
    this.map = map;
    this.callbacks = callbacks || {};
    this.popupBuilder = new PopupBuilder();
    this.activePopup = null;
    this.attachedLayers = new Set();
    this.boundHandlers = new Map();
    // Bound late so interactions reach the live method (and any test spy on it)
    // rather than a copy captured at construction.
    this.interactionDeps = {
      showPopup: (content, feature, lngLat) =>
        this.showPopup(content, feature, lngLat),
    };
    this.layerToSource = new Map();
    // One runtime per interaction per handler, so stateful interactions
    // (highlight) never share tracked features across map instances.
    const bind = (interactions: readonly Interaction[]): BoundInteraction[] =>
      interactions.map((interaction) => ({
        interaction,
        runtime: interaction.create(this.interactionDeps),
      }));
    this.clickInteractions = bind(CLICK_INTERACTIONS);
    this.hoverInteractions = bind(HOVER_INTERACTIONS);
  }

  /**
   * Attach events for a layer based on its interactive config
   */
  attachEvents(layer: Layer): void {
    if (!layer.interactive) return;

    // Type guard: interactive is defined, cast to proper type
    const interactive = layer.interactive as { hover?: any; click?: any };
    const { hover, click } = interactive;
    const handlers: any = {};

    // Source id, derived exactly as LayerManager derives it, so feature-state
    // writes address the source the data actually lives in.
    const sourceId =
      typeof layer.source === "string" ? layer.source : `${layer.id}-source`;
    this.layerToSource.set(layer.id, sourceId);

    // Hover handling
    if (hover) {
      handlers.mouseenter = (e: MapMouseEvent & { features?: any[] }) => {
        if (hover.cursor) {
          this.map.getCanvas().style.cursor = hover.cursor;
        }
        if (e.features?.[0]) {
          this.callbacks.onHover?.(layer.id, e.features[0], e.lngLat);
        }
      };

      handlers.mouseleave = () => {
        this.map.getCanvas().style.cursor = "";
        this.clearInteractionState(layer.id);
      };

      this.map.on("mouseenter", layer.id, handlers.mouseenter);
      this.map.on("mouseleave", layer.id, handlers.mouseleave);

      // mousemove only when a hover interaction needs per-feature resolution —
      // mouseenter fires once for the layer, not once per feature.
      if (this.hasHoverInteraction(hover)) {
        handlers.mousemove = (e: MapMouseEvent & { features?: any[] }) => {
          const feature = e.features?.[0];
          if (!feature) return;

          this.dispatch(this.hoverInteractions, hover, {
            map: this.map,
            layerId: layer.id,
            sourceId,
            feature,
            lngLat: e.lngLat,
          });
        };

        this.map.on("mousemove", layer.id, handlers.mousemove);
      }
    }

    // Click handling
    if (click) {
      handlers.click = (e: MapMouseEvent & { features?: any[] }) => {
        // Multi-feature clicks resolve to the topmost feature, matching hover.
        const feature = e.features?.[0];
        if (!feature) return;

        this.dispatch(this.clickInteractions, click, {
          map: this.map,
          layerId: layer.id,
          sourceId,
          feature,
          lngLat: e.lngLat,
        });

        this.callbacks.onClick?.(layer.id, feature, e.lngLat);
      };

      this.map.on("click", layer.id, handlers.click);
    }

    this.boundHandlers.set(layer.id, handlers);
    this.attachedLayers.add(layer.id);
  }

  /**
   * Run every configured interaction for a trigger, in registry order.
   *
   * @remarks
   * The single dispatch path for all triggers: `click` today, `hover` when
   * highlight lands. An interaction whose `select` finds no config is skipped.
   */
  private dispatch(
    interactions: BoundInteraction[],
    trigger: any,
    ctx: InteractionContext
  ): void {
    for (const { interaction, runtime } of interactions) {
      const config = interaction.select(trigger);
      // Falsy means not configured, matching the `if (click.popup)` check this
      // replaced. Not a nullish check: `hover.highlight` is a plain boolean, so
      // `false` is present-but-off and must not run.
      if (!config) continue;

      runtime.run(config, ctx);
    }
  }

  /** Whether any hover interaction is configured for this trigger. */
  private hasHoverInteraction(hover: any): boolean {
    return this.hoverInteractions.some(
      ({ interaction }) => !!interaction.select(hover)
    );
  }

  /**
   * Release per-layer interaction state.
   *
   * @remarks
   * Called wherever a tracked feature can stop being valid: the pointer leaves
   * the layer, events are detached, or the handler is destroyed. Stale
   * feature-state would otherwise leave a feature lit, or re-light the wrong
   * one after the source data is replaced.
   */
  private clearInteractionState(layerId: string): void {
    for (const { runtime } of this.hoverInteractions) {
      runtime.clearLayer?.(layerId, this.map);
    }
    for (const { runtime } of this.clickInteractions) {
      runtime.clearLayer?.(layerId, this.map);
    }
  }

  /**
   * Drop highlight state for a layer whose data was replaced.
   *
   * @remarks
   * Feature ids are only meaningful within a given dataset — after a refresh
   * `setData`, a retained id can address a different feature entirely.
   */
  resetFeatureState(layerId: string): void {
    this.clearInteractionState(layerId);
  }

  /**
   * Show a popup with content
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
   * Detach events for a layer
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
    this.clearInteractionState(layerId);

    this.boundHandlers.delete(layerId);
    this.attachedLayers.delete(layerId);
    this.layerToSource.delete(layerId);
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
