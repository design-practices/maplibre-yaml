/**
 * @file Unified MLMap web component for maplibre-yaml
 * @module @maplibre-yaml/core/components/ml-map
 *
 * @description
 * The `<ml-map>` component is the primary way to embed MapLibre maps configured
 * with YAML. It supports multiple configuration methods to fit any use case.
 *
 * ## Configuration Methods (in priority order)
 *
 * ### 1. External YAML File (Recommended)
 * ```html
 * <ml-map src="/configs/my-map.yaml"></ml-map>
 * ```
 *
 * ### 2. Inline YAML via Script Tag
 * ```html
 * <ml-map>
 *   <script type="text/yaml">
 * type: map
 * id: my-map
 * config:
 *   center: [-74.006, 40.7128]
 *   zoom: 12
 *   mapStyle: "https://demotiles.maplibre.org/style.json"
 * layers: []
 *   </script>
 * </ml-map>
 * ```
 *
 * ### 3. JSON Config Attribute (Programmatic)
 * ```html
 * <ml-map config='{"type":"map",...}'></ml-map>
 * ```
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import {
  YAMLParser,
  type MapBlock,
  type ParseError,
} from "../parser/yaml-parser.js";
import { MapRenderer } from "../renderer/map-renderer.js";

/**
 * MLMap custom element for rendering MapLibre maps from YAML/JSON configuration.
 *
 * @fires ml-map:load - Map loaded and ready for interaction
 * @fires ml-map:error - Error during initialization or runtime
 * @fires ml-map:loading - Loading configuration from URL
 * @fires ml-map:layer-added - Layer was added to the map
 * @fires ml-map:layer-removed - Layer was removed from the map
 * @fires ml-map:layer-data-loading - Layer data is being fetched
 * @fires ml-map:layer-data-loaded - Layer data loaded successfully
 * @fires ml-map:layer-data-error - Layer data failed to load
 * @fires ml-map:layer-click - User clicked on a layer feature
 * @fires ml-map:layer-hover - User hovered over a layer feature
 */
export class MLMap extends HTMLElement {
  /** Internal MapRenderer instance */
  private renderer: MapRenderer | null = null;

  /** Whether the component has been initialized */
  private initialized = false;

  /** Container element for the map */
  private mapContainer: HTMLDivElement | null = null;

  /** Parsed and validated configuration */
  private _config: MapBlock | null = null;

  /**
   * Observed attributes that trigger attributeChangedCallback
   */
  static get observedAttributes(): string[] {
    return ["src", "config"];
  }

  /**
   * Get the current map configuration
   */
  get config(): MapBlock | null {
    return this._config;
  }

  /**
   * Set the map configuration programmatically
   */
  set config(value: MapBlock | string | null) {
    if (value === null) {
      this._config = null;
      return;
    }

    let parsed: MapBlock;

    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch (e) {
        this.handleError([
          { path: "", message: "Invalid JSON in config property" },
        ]);
        return;
      }
    } else {
      parsed = value;
    }

    this._config = parsed;

    // If already initialized, render with new config
    if (this.initialized) {
      this.renderMap(parsed);
    }
  }

  /**
   * Called when the element is added to the DOM
   */
  connectedCallback(): void {
    // Create internal map container
    this.mapContainer = document.createElement("div");
    this.mapContainer.style.cssText = "width: 100%; height: 100%;";

    // Ensure the component has display: block (custom elements default to inline)
    if (!this.style.display || this.style.display === "inline") {
      this.style.display = "block";
    }

    // Initialize configuration loading
    this.initialize();
  }

  /**
   * Called when the element is removed from the DOM
   */
  disconnectedCallback(): void {
    this.destroy();
  }

  /**
   * Called when an observed attribute changes
   */
  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null
  ): void {
    // Skip if value hasn't actually changed
    if (oldValue === newValue) return;

    // Only process changes after initialization
    if (!this.initialized) return;

    if (name === "src" && newValue) {
      this.loadFromURL(newValue);
    } else if (name === "config" && newValue) {
      this.loadFromJSONAttribute(newValue);
    }
  }

  /**
   * Initialize the component by detecting and loading configuration
   */
  private async initialize(): Promise<void> {
    this.initialized = true;

    // Priority 1: Script tag with YAML
    const yamlScript = this.querySelector('script[type="text/yaml"]');
    if (yamlScript?.textContent) {
      this.loadFromScriptTag(yamlScript.textContent);
      return;
    }

    // Priority 2: External YAML file
    const srcAttr = this.getAttribute("src");
    if (srcAttr) {
      await this.loadFromURL(srcAttr);
      return;
    }

    // Priority 3: JSON config attribute
    const configAttr = this.getAttribute("config");
    if (configAttr) {
      this.loadFromJSONAttribute(configAttr);
      return;
    }

    // No configuration provided - show helpful error
    this.handleError(
      [
        {
          path: "",
          message: "No configuration provided.",
        },
      ],
      true
    );
  }

  /**
   * Load and parse YAML from a script tag's text content
   */
  private loadFromScriptTag(yamlContent: string): void {
    const result = YAMLParser.safeParseMapBlock(yamlContent);

    if (result.success && result.data) {
      this._config = result.data;
      this.renderMap(result.data);
    } else {
      this.handleError(result.errors);
    }
  }

  /**
   * Load and parse YAML from an external URL
   */
  private async loadFromURL(url: string): Promise<void> {
    // Emit loading event
    this.dispatchEvent(
      new CustomEvent("ml-map:loading", {
        bubbles: true,
        detail: { url },
      })
    );

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch ${url}: ${response.status} ${response.statusText}`
        );
      }

      const yamlContent = await response.text();
      const result = YAMLParser.safeParseMapBlock(yamlContent);

      if (result.success && result.data) {
        this._config = result.data;
        this.renderMap(result.data);
      } else {
        this.handleError(result.errors);
      }
    } catch (error) {
      this.handleError([
        {
          path: "",
          message: error instanceof Error ? error.message : String(error),
        },
      ]);
    }
  }

  /**
   * Parse and validate JSON from the config attribute
   */
  private loadFromJSONAttribute(jsonString: string): void {
    try {
      const parsed = JSON.parse(jsonString);
      this._config = parsed;
      this.renderMap(parsed);
    } catch (error) {
      this.handleError([
        {
          path: "",
          message: `Invalid JSON in config attribute: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ]);
    }
  }

  /**
   * Render the map with the given configuration
   */
  private renderMap(mapBlock: MapBlock): void {
    // Destroy existing renderer
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }

    // Clear content and set up container
    this.innerHTML = "";

    if (!this.mapContainer) {
      this.mapContainer = document.createElement("div");
      this.mapContainer.style.cssText = "width: 100%; height: 100%;";
    }

    this.appendChild(this.mapContainer);

    try {
      // Extract config and layers from MapBlock
      const { config, layers = [] } = mapBlock;

      // Create renderer with config and layers
      this.renderer = new MapRenderer(this.mapContainer, config, layers, {
        onLoad: () => {
          // Load event is also emitted via the event system
        },
        onError: (error) => {
          this.dispatchEvent(
            new CustomEvent("ml-map:error", {
              bubbles: true,
              detail: { error },
            })
          );
        },
      });

      // Set up event forwarding
      this.setupEventForwarding();
    } catch (error) {
      this.handleError([
        {
          path: "",
          message: `Failed to create map: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ]);
    }
  }

  /**
   * Forward MapRenderer events to custom element events
   */
  private setupEventForwarding(): void {
    if (!this.renderer) return;

    // Map load event
    this.renderer.on("load", () => {
      this.dispatchEvent(
        new CustomEvent("ml-map:load", {
          bubbles: true,
          detail: {},
        })
      );
    });

    // Layer added
    this.renderer.on("layer:added", ({ layerId }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-added", {
          bubbles: true,
          detail: { layerId },
        })
      );
    });

    // Layer removed
    this.renderer.on("layer:removed", ({ layerId }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-removed", {
          bubbles: true,
          detail: { layerId },
        })
      );
    });

    // Layer data loading
    this.renderer.on("layer:data-loading", ({ layerId }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-data-loading", {
          bubbles: true,
          detail: { layerId },
        })
      );
    });

    // Layer data loaded
    this.renderer.on("layer:data-loaded", ({ layerId, featureCount }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-data-loaded", {
          bubbles: true,
          detail: { layerId, featureCount },
        })
      );
    });

    // Layer data error
    this.renderer.on("layer:data-error", ({ layerId, error }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-data-error", {
          bubbles: true,
          detail: { layerId, error },
        })
      );
    });

    // Layer click
    this.renderer.on("layer:click", ({ layerId, feature, lngLat }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-click", {
          bubbles: true,
          detail: { layerId, feature, lngLat },
        })
      );
    });

    // Layer hover
    this.renderer.on("layer:hover", ({ layerId, feature, lngLat }) => {
      this.dispatchEvent(
        new CustomEvent("ml-map:layer-hover", {
          bubbles: true,
          detail: { layerId, feature, lngLat },
        })
      );
    });
  }

  /**
   * Handle and display errors
   */
  private handleError(errors: ParseError[], showHelp = false): void {
    // Dispatch error event
    this.dispatchEvent(
      new CustomEvent("ml-map:error", {
        bubbles: true,
        detail: { errors },
      })
    );

    // Build error UI
    const helpSection = showHelp
      ? `
        <div style="margin-top: 16px; padding: 16px; background: #fef3c7; border-radius: 6px; color: #92400e;">
          <strong style="display: block; margin-bottom: 8px;">How to configure:</strong>
          <div style="font-family: monospace; font-size: 12px; line-height: 1.6;">
            <div style="margin-bottom: 8px;">
              <strong>1. External file (recommended):</strong><br>
              &lt;ml-map src="/path/to/config.yaml"&gt;&lt;/ml-map&gt;
            </div>
            <div style="margin-bottom: 8px;">
              <strong>2. Inline YAML:</strong><br>
              &lt;ml-map&gt;<br>
              &nbsp;&nbsp;&lt;script type="text/yaml"&gt;<br>
              &nbsp;&nbsp;type: map<br>
              &nbsp;&nbsp;id: my-map<br>
              &nbsp;&nbsp;...<br>
              &nbsp;&nbsp;&lt;/script&gt;<br>
              &lt;/ml-map&gt;
            </div>
            <div>
              <strong>3. JSON attribute:</strong><br>
              &lt;ml-map config='{"type":"map",...}'&gt;&lt;/ml-map&gt;
            </div>
          </div>
        </div>
      `
      : "";

    const errorItems = errors
      .map(
        (err) => `
          <div style="margin-bottom: 8px; padding: 8px; background: #fee2e2; border-radius: 4px;">
            ${
              err.path
                ? `<strong style="color: #991b1b;">${this.escapeHtml(
                    err.path
                  )}</strong>: `
                : ""
            }
            ${this.escapeHtml(err.message)}
          </div>
        `
      )
      .join("");

    this.innerHTML = `
      <div class="ml-map-error" style="
        padding: 20px;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 8px;
        color: #dc2626;
        font-family: system-ui, -apple-system, sans-serif;
        height: 100%;
        box-sizing: border-box;
        overflow: auto;
      ">
        <div style="font-weight: 600; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
          </svg>
          Configuration Error
        </div>
        <div style="font-size: 14px;">
          ${errorItems}
        </div>
        ${helpSection}
      </div>
    `;
  }

  /**
   * Escape HTML special characters for safe innerHTML usage
   */
  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Clean up resources when component is removed
   */
  private destroy(): void {
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
    this._config = null;
    this.initialized = false;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Get the underlying MapLibre GL map instance
   *
   * @returns The MapLibre GL map instance, or null if not initialized
   *
   * @example
   * ```javascript
   * const mapEl = document.querySelector('ml-map');
   *
   * mapEl.addEventListener('ml-map:load', () => {
   *   const map = mapEl.getMap();
   *   map.flyTo({ center: [-122.4, 37.8], zoom: 14 });
   * });
   * ```
   */
  getMap(): MapLibreMap | null {
    return this.renderer?.getMap() ?? null;
  }

  /**
   * Get the MapRenderer instance
   *
   * @returns The MapRenderer instance, or null if not initialized
   */
  getRenderer(): MapRenderer | null {
    return this.renderer;
  }

  /**
   * Check if the map is loaded
   *
   * @returns True if the map has finished loading
   */
  isLoaded(): boolean {
    return this.renderer?.isMapLoaded() ?? false;
  }

  /**
   * Add a layer to the map
   *
   * @param layer - Layer configuration object
   * @returns Promise that resolves when the layer is added
   *
   * @example
   * ```javascript
   * await mapEl.addLayer({
   *   id: 'new-layer',
   *   type: 'circle',
   *   source: {
   *     type: 'geojson',
   *     data: { type: 'FeatureCollection', features: [] }
   *   },
   *   paint: { 'circle-radius': 6, 'circle-color': '#ff0000' }
   * });
   * ```
   */
  async addLayer(layer: any): Promise<void> {
    await this.renderer?.addLayer(layer);
  }

  /**
   * Remove a layer from the map
   *
   * @param layerId - ID of the layer to remove
   */
  removeLayer(layerId: string): void {
    this.renderer?.removeLayer(layerId);
  }

  /**
   * Set layer visibility
   *
   * @param layerId - ID of the layer
   * @param visible - Whether the layer should be visible
   */
  setLayerVisibility(layerId: string, visible: boolean): void {
    this.renderer?.setLayerVisibility(layerId, visible);
  }

  /**
   * Update layer data
   *
   * @param layerId - ID of the layer
   * @param data - New GeoJSON data
   */
  updateLayerData(layerId: string, data: GeoJSON.GeoJSON): void {
    this.renderer?.updateLayerData(layerId, data);
  }

  /**
   * Reload configuration from the current source
   *
   * @returns Promise that resolves when reload is complete
   */
  async reload(): Promise<void> {
    const src = this.getAttribute("src");

    if (src) {
      await this.loadFromURL(src);
    } else {
      const yamlScript = this.querySelector('script[type="text/yaml"]');
      if (yamlScript?.textContent) {
        this.loadFromScriptTag(yamlScript.textContent);
      }
    }
  }
}

/**
 * Register the ml-map custom element
 */
export function registerMLMap(): void {
  if (typeof window !== "undefined" && !customElements.get("ml-map")) {
    customElements.define("ml-map", MLMap);
  }
}
