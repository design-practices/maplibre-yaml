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
  type Interaction,
  type InteractionContext,
  type InteractionDeps,
} from "./interactions";

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
    { click?: Function; mouseenter?: Function; mouseleave?: Function }
  >;
  private interactionDeps: InteractionDeps;

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
      };

      this.map.on("mouseenter", layer.id, handlers.mouseenter);
      this.map.on("mouseleave", layer.id, handlers.mouseleave);
    }

    // Click handling
    if (click) {
      handlers.click = (e: MapMouseEvent & { features?: any[] }) => {
        // Multi-feature clicks resolve to the topmost feature, matching hover.
        const feature = e.features?.[0];
        if (!feature) return;

        this.dispatch(CLICK_INTERACTIONS, click, {
          map: this.map,
          layerId: layer.id,
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
    interactions: readonly Interaction[],
    trigger: any,
    ctx: InteractionContext
  ): void {
    for (const interaction of interactions) {
      const config = interaction.select(trigger);
      // Falsy means not configured, matching the `if (click.popup)` check this
      // replaced. Not a nullish check: `hover.highlight` is a plain boolean, so
      // `false` is present-but-off and must not run.
      if (!config) continue;

      interaction.run(config, ctx, this.interactionDeps);
    }
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
