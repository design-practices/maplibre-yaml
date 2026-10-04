/**
 * @file Default CSS styles for ml-map web component
 * @module @maplibre-yaml/core/components
 */

/**
 * Default CSS styles for the ml-map custom element
 *
 * These styles ensure:
 * - The ml-map element behaves as a block-level container
 * - The map fills the available space
 * - Proper display defaults for embedded elements
 * - Slot children stay hidden until the renderer adopts them into a chrome
 *   corner (they stop being direct children once mounted)
 */
export const defaultStyles = `
  ml-map {
    display: block;
    position: relative;
    width: 100%;
    height: 400px;
  }

  ml-map > .ml-map-container {
    width: 100%;
    height: 100%;
  }

  ml-map > [slot="top-left"],
  ml-map > [slot="top-right"],
  ml-map > [slot="bottom-left"],
  ml-map > [slot="bottom-right"],
  ml-map > [slot="legend"] {
    display: none;
  }

  ml-map script[type="text/yaml"],
  ml-map script[type="application/yaml"],
  ml-map script[type="application/json"] {
    display: none;
  }
`;

/**
 * Inject default styles into the document head
 *
 * This function is idempotent - it will only inject styles once even if called multiple times.
 */
export function injectStyles(): void {
  if (typeof document === "undefined") return;

  // Check if styles are already injected
  const existingStyle = document.getElementById("ml-map-styles");
  if (existingStyle) return;

  // Create and inject style element
  const style = document.createElement("style");
  style.id = "ml-map-styles";
  style.textContent = defaultStyles;
  document.head.appendChild(style);
}

// Auto-inject styles when module is loaded in browser environment
if (typeof window !== "undefined") {
  injectStyles();
}
