/**
 * @file Custom HTML element for declarative map creation
 * @module @maplibre-yaml/core/components
 */

import { MapRenderer } from "../renderer";
import { safeParseYAMLConfig } from "../parser";
import type { z } from "zod";
import { MapBlockSchema } from "../schemas";

type MapBlock = z.infer<typeof MapBlockSchema>;

/**
 * Custom HTML element for creating maps declaratively
 *
 * @example
 * ```html
 * <!-- Using JSON attribute -->
 * <ml-map config='{"config": {...}, "layers": [...]}'></ml-map>
 *
 * <!-- Using inline YAML -->
 * <ml-map>
 *   <script type="application/yaml">
 *     config:
 *       mapStyle: https://demotiles.maplibre.org/style.json
 *       center: [-74.5, 40]
 *       zoom: 9
 *     layers:
 *       - id: points
 *         type: circle
 *   </script>
 * </ml-map>
 *
 * <!-- Using inline JSON -->
 * <ml-map>
 *   <script type="application/json">
 *     {
 *       "config": {
 *         "mapStyle": "https://demotiles.maplibre.org/style.json",
 *         "center": [-74.5, 40],
 *         "zoom": 9
 *       }
 *     }
 *   </script>
 * </ml-map>
 * ```
 */
export class MLMap extends HTMLElement {
  private renderer: MapRenderer | null = null;
  private container: HTMLDivElement | null = null;

  /**
   * Observed attributes that trigger attributeChangedCallback
   */
  static get observedAttributes(): string[] {
    return ["config"];
  }

  /**
   * Called when element is added to the DOM
   */
  connectedCallback(): void {
    // Create container div for the map
    this.container = document.createElement("div");
    this.container.style.width = "100%";
    this.container.style.height = "100%";
    this.appendChild(this.container);

    // Get config and render
    const config = this.getConfig();
    if (config) {
      this.render(config);
    } else {
      this.dispatchEvent(
        new CustomEvent("error", {
          detail: { error: new Error("No valid map configuration found") },
        })
      );
    }
  }

  /**
   * Called when element is removed from the DOM
   */
  disconnectedCallback(): void {
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }

  /**
   * Called when an observed attribute changes
   */
  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null
  ): void {
    if (name === "config" && oldValue !== newValue && this.container) {
      // Destroy existing renderer
      if (this.renderer) {
        this.renderer.destroy();
        this.renderer = null;
      }

      // Re-render with new config
      const config = this.getConfig();
      if (config) {
        this.render(config);
      }
    }
  }

  /**
   * Get configuration from one of three sources:
   * 1. 'config' attribute (JSON string)
   * 2. Inline <script type="application/yaml">
   * 3. Inline <script type="application/json">
   */
  private getConfig(): MapBlock | null {
    // Try 'config' attribute (JSON string)
    const configAttr = this.getAttribute("config");
    if (configAttr) {
      try {
        const parsed = JSON.parse(configAttr);
        const result = MapBlockSchema.safeParse(parsed);
        if (result.success) {
          return result.data;
        } else {
          console.error("Invalid map config in attribute:", result.error);
        }
      } catch (error) {
        console.error("Failed to parse config attribute as JSON:", error);
      }
    }

    // Try inline <script type="application/yaml">
    const yamlScript = this.querySelector(
      'script[type="application/yaml"]'
    ) as HTMLScriptElement;
    if (yamlScript?.textContent) {
      try {
        const parsed = safeParseYAMLConfig(yamlScript.textContent);
        if (parsed.success) {
          // Find the first map block in pages
          for (const page of parsed.data.pages || []) {
            const mapBlock = page.blocks?.find(
              (block: any) => block.type === "map"
            );
            if (mapBlock) {
              return mapBlock as MapBlock;
            }
          }
        } else {
          console.error("Invalid YAML config:", parsed.errors);
        }
      } catch (error) {
        console.error("Failed to parse YAML config:", error);
      }
    }

    // Try inline <script type="application/json">
    const jsonScript = this.querySelector(
      'script[type="application/json"]'
    ) as HTMLScriptElement;
    if (jsonScript?.textContent) {
      try {
        const parsed = JSON.parse(jsonScript.textContent);
        const result = MapBlockSchema.safeParse(parsed);
        if (result.success) {
          return result.data;
        } else {
          console.error("Invalid JSON config:", result.error);
        }
      } catch (error) {
        console.error("Failed to parse JSON config:", error);
      }
    }

    return null;
  }

  /**
   * Render the map with the given configuration
   */
  private render(config: MapBlock): void {
    if (!this.container) return;

    try {
      this.renderer = new MapRenderer(
        this.container,
        config.config,
        config.layers || [],
        {
          onLoad: () => {
            // Add controls if specified
            if (config.controls) {
              this.renderer?.addControls(config.controls);
            }

            // Legend configuration is handled by MapRenderer internally
            // No explicit legend building needed here

            // Dispatch load event
            this.dispatchEvent(
              new CustomEvent("load", {
                detail: { map: this.renderer?.getMap() },
              })
            );
          },
          onError: (error) => {
            this.dispatchEvent(
              new CustomEvent("error", {
                detail: { error },
              })
            );
          },
        }
      );
    } catch (error) {
      this.dispatchEvent(
        new CustomEvent("error", {
          detail: { error },
        })
      );
    }
  }

  /**
   * Get the underlying MapRenderer instance
   */
  getRenderer(): MapRenderer | null {
    return this.renderer;
  }

  /**
   * Get the underlying MapLibre Map instance
   */
  getMap(): any {
    return this.renderer?.getMap() ?? null;
  }
}

// Register the custom element
if (typeof window !== "undefined" && !customElements.get("ml-map")) {
  customElements.define("ml-map", MLMap);
}
