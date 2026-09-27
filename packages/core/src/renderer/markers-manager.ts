/**
 * @file Live `markers:` — DOM marker lifecycle (U5, R8)
 * @module @maplibre-yaml/core/renderer
 *
 * @description
 * The runtime half of the markers construct: each entry becomes a
 * `maplibregl.Marker` (the real DOM pin, with drag-free defaults), colored /
 * scaled per the document, optionally carrying a popup whose content runs
 * through the same `PopupBuilder(policy)` gate as every other popup sink.
 *
 * Icon URLs load as `<img>` elements; a failed load falls back to the
 * default pin with one console warning (never a blank marker), mirroring the
 * warn-once conventions elsewhere in the renderer.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { Marker, Popup } from "./maplibre-interop";
import { PopupBuilder } from "./popup-builder";
import type { CapabilityPolicy } from "../capabilities";
import type { MarkerConfig } from "../schemas/map.schema";

export class MarkersManager {
  private markers: Marker[] = [];
  private readonly popupBuilder: PopupBuilder;
  /** Warn once per document about failed icons, not once per marker. */
  private warnedIconFailure = false;

  constructor(
    private readonly map: MapLibreMap,
    policy?: CapabilityPolicy
  ) {
    this.popupBuilder = new PopupBuilder(policy);
  }

  /** Add every configured marker to the map. */
  add(configs: readonly MarkerConfig[]): void {
    for (const config of configs) this.markers.push(this.create(config));
  }

  private create(config: MarkerConfig): Marker {
    const marker = new Marker({
      ...(config.icon !== undefined
        ? { element: this.iconElement(config) }
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

    marker.addTo(this.map);
    return marker;
  }

  /**
   * An `<img>` marker element for `icon:` URLs, sized like the default pin
   * unless the document scales it. On load failure the marker swaps to the
   * default pin (via a fresh Marker) rather than showing nothing.
   */
  private iconElement(config: MarkerConfig): HTMLElement {
    const size = config.size ?? 1;
    const img = document.createElement("img");
    img.src = config.icon!;
    img.style.width = `${Math.round(27 * size)}px`;
    img.style.cursor = "pointer";
    img.addEventListener("error", () => {
      if (!this.warnedIconFailure) {
        this.warnedIconFailure = true;
        console.warn(
          `[maplibre-yaml] marker icon "${config.icon}" failed to load; ` +
            "falling back to the default pin."
        );
      }
      // Replace the broken img with the default pin's SVG in place, keeping
      // the same Marker (position, popup) alive.
      const fallback = new Marker({
        ...(config.color !== undefined ? { color: config.color } : {}),
        ...(config.size !== undefined ? { scale: config.size } : {}),
      });
      const pinElement = fallback.getElement();
      img.replaceWith(pinElement);
    });
    return img;
  }

  /** Remove every marker from the DOM (renderer destroy/reload). */
  destroy(): void {
    for (const marker of this.markers) marker.remove();
    this.markers = [];
  }
}
