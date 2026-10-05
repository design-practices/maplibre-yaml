/**
 * @file Live `popups:` — standalone popups open at a coordinate (U14)
 * @module @maplibre-yaml/core/renderer
 *
 * @description
 * MapLibre's `display-a-popup`: `new Popup().setLngLat(at).setHTML(...)
 * .addTo(map)` with no layer and no marker. Content runs through the same
 * `PopupBuilder(policy)` trust gate as every other popup sink (layer click /
 * hover popups, marker popups) — feature-less, so `property:` lookups
 * resolve empty and `str:` carries the text.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { Popup } from "./maplibre-interop";
import { liftPopup } from "./chrome-layout";
import { PopupBuilder } from "./popup-builder";
import type { CapabilityPolicy } from "../capabilities";
import type { StandalonePopupConfig } from "../schemas/map.schema";

export class PopupsManager {
  private popups: Popup[] = [];
  private readonly popupBuilder: PopupBuilder;

  constructor(
    private readonly map: MapLibreMap,
    policy?: CapabilityPolicy
  ) {
    this.popupBuilder = new PopupBuilder(policy);
  }

  /** Open every configured popup. */
  add(configs: readonly StandalonePopupConfig[]): void {
    for (const config of configs) {
      // Only authored options are passed: an explicit `undefined` would
      // override MapLibre's own defaults (closeButton/closeOnClick true).
      const options: { closeButton?: boolean; closeOnClick?: boolean; maxWidth?: string } = {};
      if (config.closeButton !== undefined) options.closeButton = config.closeButton;
      if (config.closeOnClick !== undefined) options.closeOnClick = config.closeOnClick;
      if (config.maxWidth !== undefined) options.maxWidth = config.maxWidth;

      const popup = liftPopup(new Popup(options))
        .setLngLat(config.at as [number, number])
        .setHTML(this.popupBuilder.build(config.content, {}))
        .addTo(this.map);
      this.popups.push(popup);
    }
  }

  /** Remove every popup (renderer destroy/reload). */
  destroy(): void {
    for (const popup of this.popups) popup.remove();
    this.popups = [];
  }
}
