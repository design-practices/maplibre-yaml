/**
 * @file Controls manager for map controls
 * @module @maplibre-yaml/core/renderer
 */

import type { Map as MapLibreMap, IControl } from "maplibre-gl";
import {
  NavigationControl,
  GeolocateControl,
  ScaleControl,
  FullscreenControl,
  AttributionControl,
} from "./maplibre-interop";
import type { z } from "zod";
import { ControlsConfigSchema } from "../schemas";
import { sanitizeCustomAttribution } from "../utils/attribution";

type ControlsConfig = z.infer<typeof ControlsConfigSchema>;

/**
 * Manages MapLibre map controls (navigation, geolocate, scale, etc.)
 */
export class ControlsManager {
  private map: MapLibreMap;
  private addedControls: IControl[];
  private beforeAttribution?: () => void;

  /**
   * @param beforeAttribution - called immediately before an attribution
   *   control is added; the renderer passes its attribution guard's `scrub`,
   *   because the control renders source attributions synchronously in `onAdd`.
   */
  constructor(map: MapLibreMap, beforeAttribution?: () => void) {
    this.map = map;
    this.addedControls = [];
    this.beforeAttribution = beforeAttribution;
  }

  /**
   * Add controls to the map based on configuration
   */
  addControls(config: ControlsConfig): void {
    if (!config) return;

    if (config.navigation) {
      const options =
        typeof config.navigation === "object" ? config.navigation : {};
      const position = (options as any).position || "top-right";
      const control = new NavigationControl();
      this.map.addControl(control, position as any);
      this.addedControls.push(control);
    }

    if (config.geolocate) {
      const options =
        typeof config.geolocate === "object" ? config.geolocate : {};
      const position = (options as any).position || "top-right";
      const control = new GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      });
      this.map.addControl(control, position as any);
      this.addedControls.push(control);
    }

    if (config.scale) {
      const options = typeof config.scale === "object" ? config.scale : {};
      const position = (options as any).position || "bottom-left";
      const control = new ScaleControl();
      this.map.addControl(control, position as any);
      this.addedControls.push(control);
    }

    if (config.fullscreen) {
      const options =
        typeof config.fullscreen === "object" ? config.fullscreen : {};
      const position = (options as any).position || "top-right";
      const control = new FullscreenControl();
      this.map.addControl(control, position as any);
      this.addedControls.push(control);
    }

    if (config.attribution) {
      const options =
        typeof config.attribution === "object" ? config.attribution : {};
      const position = (options as any).position || "bottom-right";
      // MapLibre renders customAttribution through a sanitizer that can be
      // bypassed (GHSA-jrc7-96c5-q579); ours runs first, whatever the trust
      // context — see utils/attribution.ts.
      const control = new AttributionControl({
        compact: (options as any).compact,
        customAttribution: sanitizeCustomAttribution((options as any).customAttribution).value,
      });
      this.beforeAttribution?.();
      this.map.addControl(control, position as any);
      this.addedControls.push(control);
    }
  }

  /**
   * Remove all controls from the map
   */
  removeAllControls(): void {
    for (const control of this.addedControls) {
      this.map.removeControl(control);
    }
    this.addedControls = [];
  }
}
