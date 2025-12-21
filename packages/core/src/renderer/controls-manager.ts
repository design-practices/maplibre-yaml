/**
 * @file Controls manager for map controls
 * @module @maplibre-yaml/core/renderer
 */

import maplibregl, {
  type Map as MapLibreMap,
  type IControl,
} from "maplibre-gl";
import type { z } from "zod";
import { ControlsConfigSchema } from "../schemas";

type ControlsConfig = z.infer<typeof ControlsConfigSchema>;

/**
 * Manages MapLibre map controls (navigation, geolocate, scale, etc.)
 */
export class ControlsManager {
  private map: MapLibreMap;
  private addedControls: IControl[];

  constructor(map: MapLibreMap) {
    this.map = map;
    this.addedControls = [];
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
      const control = new maplibregl.NavigationControl();
      this.map.addControl(control, position as any);
      this.addedControls.push(control);
    }

    if (config.geolocate) {
      const options =
        typeof config.geolocate === "object" ? config.geolocate : {};
      const position = (options as any).position || "top-right";
      const control = new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      });
      this.map.addControl(control, position as any);
      this.addedControls.push(control);
    }

    if (config.scale) {
      const options = typeof config.scale === "object" ? config.scale : {};
      const position = (options as any).position || "bottom-left";
      const control = new maplibregl.ScaleControl();
      this.map.addControl(control, position as any);
      this.addedControls.push(control);
    }

    if (config.fullscreen) {
      const options =
        typeof config.fullscreen === "object" ? config.fullscreen : {};
      const position = (options as any).position || "top-right";
      const control = new maplibregl.FullscreenControl();
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
