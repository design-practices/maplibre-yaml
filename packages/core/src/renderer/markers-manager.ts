/**
 * @file Live `markers:` — DOM marker lifecycle (U5, R8)
 * @module @maplibre-yaml/core/renderer
 *
 * @description
 * The runtime half of the markers construct: each entry becomes a
 * `maplibregl.Marker` (the real DOM pin), colored / scaled per the document,
 * optionally carrying a popup whose content runs through the same
 * `PopupBuilder(policy)` gate as every other popup sink. Icon URLs pass the
 * same `safeUrl` scheme gate popup images use — an unsafe scheme falls back
 * to the default pin with a warning, exactly like a failed load.
 *
 * A failed icon load REPLACES the whole marker with a default-pin marker at
 * the same position (popup re-attached) rather than swapping DOM under
 * MapLibre's feet: `Marker` keeps applying its position transform to the
 * element it was constructed with, so an in-place `replaceWith` would leave
 * the visible pin frozen at the container origin and orphaned past
 * `destroy()`.
 *
 * Structured signals mirror the layer conventions (`layer:added`,
 * `layer:data-error`): the callbacks here surface `markers:added`,
 * `marker:click`, and `marker:icon-error` through `MapRenderer`'s event bus
 * and on to `<ml-map>` — a programmatic consumer never has to scrape the
 * console or the DOM.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { Marker, Popup } from "./maplibre-interop";
import { PopupBuilder } from "./popup-builder";
import { safeUrl } from "../utils/html";
import { DEFAULT_PIN_WIDTH } from "../emitter/assets";
import type { CapabilityPolicy } from "../capabilities";
import type { MarkerConfig } from "../schemas/map.schema";

/** Structured signals, wired into MapRenderer's event bus by the caller. */
export interface MarkersManagerCallbacks {
  onMarkersAdded?: (count: number) => void;
  onMarkerClick?: (index: number, at: [number, number]) => void;
  onMarkerIconError?: (index: number, icon: string) => void;
}

export class MarkersManager {
  private markers: Marker[] = [];
  private readonly popupBuilder: PopupBuilder;
  /** Warn once per document about failed icons, not once per marker. */
  private warnedIconFailure = false;

  constructor(
    private readonly map: MapLibreMap,
    policy?: CapabilityPolicy,
    private readonly callbacks: MarkersManagerCallbacks = {}
  ) {
    this.popupBuilder = new PopupBuilder(policy);
  }

  /** Add every configured marker to the map. */
  add(configs: readonly MarkerConfig[]): void {
    configs.forEach((config, index) => {
      this.markers.push(this.create(config, index));
    });
    if (configs.length > 0) this.callbacks.onMarkersAdded?.(configs.length);
  }

  private create(config: MarkerConfig, index: number, forcePin = false): Marker {
    const icon = forcePin ? undefined : this.gatedIcon(config, index);
    const marker = new Marker({
      ...(icon !== undefined
        ? { element: this.iconElement(icon, config, index) }
        : {
            ...(config.color !== undefined ? { color: config.color } : {}),
            ...(config.size !== undefined ? { scale: config.size } : {}),
          }),
    }).setLngLat(config.at as [number, number]);

    if (config.popup !== undefined) {
      // The document's structured popup content, through the same trust gate
      // as layer popups — feature-less, so property lookups resolve empty.
      const html = this.popupBuilder.build(config.popup, {});
      marker.setPopup(new Popup().setHTML(html));
    }

    marker.getElement().addEventListener("click", () => {
      this.callbacks.onMarkerClick?.(index, config.at as [number, number]);
    });

    marker.addTo(this.map);
    return marker;
  }

  /** The icon URL, or undefined when absent or scheme-unsafe (warn once). */
  private gatedIcon(config: MarkerConfig, index: number): string | undefined {
    if (config.icon === undefined) return undefined;
    // The same scheme gate popup images pass (utils/html.ts SAFE_SCHEMES):
    // markers advertise "same trust posture as popups", so icon: cannot be
    // the ungated exception.
    const gated = safeUrl(config.icon);
    if (gated === null) {
      console.warn(
        `[maplibre-yaml] Dropping marker icon with unsafe URL scheme: ${config.icon}; ` +
          "using the default pin."
      );
      this.callbacks.onMarkerIconError?.(index, config.icon);
      return undefined;
    }
    return gated;
  }

  /**
   * An `<img>` marker element for `icon:` URLs, sized like the default pin
   * unless the document scales it.
   */
  private iconElement(icon: string, config: MarkerConfig, index: number): HTMLElement {
    const size = config.size ?? 1;
    const img = document.createElement("img");
    img.src = icon;
    img.style.width = `${Math.round(DEFAULT_PIN_WIDTH * size)}px`;
    img.style.cursor = "pointer";
    img.addEventListener("error", () => {
      if (!this.warnedIconFailure) {
        this.warnedIconFailure = true;
        console.warn(
          `[maplibre-yaml] marker icon "${icon}" failed to load; ` +
            "falling back to the default pin."
        );
      }
      this.callbacks.onMarkerIconError?.(index, icon);
      this.replaceWithPin(index, config);
    });
    return img;
  }

  /**
   * Swap a broken-icon marker for a fresh default-pin marker at the same
   * position, popup and all. A whole-marker replacement, never a DOM swap —
   * see the file header for why.
   */
  private replaceWithPin(index: number, config: MarkerConfig): void {
    const broken = this.markers[index];
    if (!broken) return;
    broken.remove();
    this.markers[index] = this.create(config, index, /* forcePin */ true);
  }

  /** Remove every marker from the DOM (renderer destroy/reload). */
  destroy(): void {
    for (const marker of this.markers) marker.remove();
    this.markers = [];
  }
}
