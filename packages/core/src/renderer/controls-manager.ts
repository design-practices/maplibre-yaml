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
  GlobeControl,
  TerrainControl,
} from "./maplibre-interop";
import type { z } from "zod";
import { ControlsConfigSchema } from "../schemas";
import { sanitizeCustomAttribution } from "../utils/attribution";
import type { TerrainConfig } from "../schemas/map.schema";

type ControlsConfig = z.infer<typeof ControlsConfigSchema>;

/**
 * Manages MapLibre map controls (navigation, geolocate, scale, etc.)
 */
export class ControlsManager {
  private map: MapLibreMap;
  private addedControls: IControl[];
  private beforeAttribution?: () => void;

  /** The document's `terrain:` — what `controls.terrain` toggles (U15). */
  private terrain: TerrainConfig | undefined;

  /**
   * @param options.terrain - the document's `terrain:` (what `controls.terrain` toggles).
   * @param options.beforeAttribution - called immediately before an attribution
   *   control is added; the renderer passes its attribution guard's `scrub`,
   *   because the control renders source attributions synchronously in `onAdd`.
   */
  constructor(
    map: MapLibreMap,
    options: { terrain?: TerrainConfig; beforeAttribution?: () => void } = {}
  ) {
    this.map = map;
    this.addedControls = [];
    this.terrain = options.terrain;
    this.beforeAttribution = options.beforeAttribution;
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

    // 3D toggles (U15). Both are feature-detected: a runtime without the
    // control class declares the absence with one warning rather than
    // throwing on `new undefined`.
    if (config.globe) {
      const options = typeof config.globe === "object" ? config.globe : {};
      const position = (options as any).position || "top-right";
      if (GlobeControl) {
        const control = new GlobeControl();
        this.map.addControl(control, position as any);
        this.addedControls.push(control);
      } else {
        console.warn(
          "[maplibre-yaml] `controls.globe` needs maplibre-gl >= 5.0.0 (GlobeControl); " +
            "the control is not shown."
        );
      }
    }

    if (config.terrain) {
      const options = typeof config.terrain === "object" ? config.terrain : {};
      const position = (options as any).position || "top-right";
      if (!this.terrain) {
        console.warn(
          "[maplibre-yaml] `controls.terrain` toggles the document's `terrain:`, " +
            "which this document does not declare; the control is not shown."
        );
      } else if (!TerrainControl) {
        console.warn(
          "[maplibre-yaml] `controls.terrain` needs a maplibre-gl with TerrainControl; " +
            "the control is not shown."
        );
      } else {
        const control = new TerrainControl({
          source: this.terrain.source,
          ...(this.terrain.exaggeration !== undefined
            ? { exaggeration: this.terrain.exaggeration }
            : {}),
        });
        this.map.addControl(control, position as any);
        this.addedControls.push(control);
      }
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
