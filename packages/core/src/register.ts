/**
 * @file Auto-registration for maplibre-yaml web components
 * @module @maplibre-yaml/core/register
 *
 * @description
 * Import this module to automatically register the `<ml-map>` web component.
 *
 * ## Usage
 *
 * ```javascript
 * import '@maplibre-yaml/core/register';
 * import 'maplibre-gl/dist/maplibre-gl.css';
 * ```
 *
 * After importing, the `<ml-map>` element is available in your HTML.
 *
 * @example
 * External YAML file (recommended)
 * ```html
 * <ml-map src="/configs/my-map.yaml" style="height: 400px;"></ml-map>
 * ```
 *
 * @example
 * Inline YAML via script tag
 * ```html
 * <ml-map style="height: 400px;">
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
 * @example
 * JSON config attribute (programmatic)
 * ```html
 * <ml-map config='{"type":"map","id":"demo",...}'></ml-map>
 * ```
 */

import { MLMap, registerMLMap } from "./components/ml-map.js";

// Export for manual use if needed
export { MLMap, registerMLMap };

// Auto-register when imported in browser context
if (typeof window !== "undefined") {
  registerMLMap();
}
