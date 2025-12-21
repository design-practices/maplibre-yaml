/**
 * @file Event handler for map layer interactions
 * @module @maplibre-yaml/core/renderer
 */

import maplibregl, {
  type Map as MapLibreMap,
  type MapMouseEvent,
  type Popup,
  type LngLat,
} from "maplibre-gl";
import type { z } from "zod";
import { LayerSchema, PopupContentSchema } from "../schemas";
import { PopupBuilder } from "./popup-builder";

type Layer = z.infer<typeof LayerSchema>;
type PopupContent = z.infer<typeof PopupContentSchema>;

/**
 * Callbacks for interactive events
 */
export interface EventHandlerCallbacks {
  onClick?: (layerId: string, feature: any, lngLat: LngLat) => void;
  onHover?: (layerId: string, feature: any, lngLat: LngLat) => void;
}

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

  constructor(map: MapLibreMap, callbacks?: EventHandlerCallbacks) {
    this.map = map;
    this.callbacks = callbacks || {};
    this.popupBuilder = new PopupBuilder();
    this.activePopup = null;
    this.attachedLayers = new Set();
    this.boundHandlers = new Map();
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
        const feature = e.features?.[0];
        if (!feature) return;

        if (click.popup) {
          this.showPopup(click.popup, feature, e.lngLat);
        }

        this.callbacks.onClick?.(layer.id, feature, e.lngLat);
      };

      this.map.on("click", layer.id, handlers.click);
    }

    this.boundHandlers.set(layer.id, handlers);
    this.attachedLayers.add(layer.id);
  }

  /**
   * Show a popup with content
   */
  private showPopup(content: PopupContent, feature: any, lngLat: LngLat): void {
    this.activePopup?.remove();

    const html = this.popupBuilder.build(content, feature.properties);

    this.activePopup = new maplibregl.Popup()
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
