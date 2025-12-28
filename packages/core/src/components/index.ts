/**
 * @file Web components for maplibre-yaml
 * @module @maplibre-yaml/core/components
 *
 * @description
 * This module exports the `<ml-map>` web component for rendering
 * MapLibre maps from YAML or JSON configuration.
 *
 * ## Quick Start
 *
 * For most users, import the auto-registration module:
 *
 * ```javascript
 * import '@maplibre-yaml/core/register';
 * import 'maplibre-gl/dist/maplibre-gl.css';
 * ```
 *
 * Then use the component in HTML:
 *
 * ```html
 * <ml-map src="/configs/my-map.yaml" style="height: 400px;"></ml-map>
 * ```
 *
 * ## Configuration Methods
 *
 * The `<ml-map>` component supports three ways to provide configuration:
 *
 * ### 1. External YAML File (Recommended)
 * ```html
 * <ml-map src="/configs/map.yaml"></ml-map>
 * ```
 *
 * ### 2. Inline YAML (Script Tag)
 * ```html
 * <ml-map>
 *   <script type="text/yaml">
 * type: map
 * id: inline
 * config:
 *   center: [0, 0]
 *   zoom: 2
 *   mapStyle: "https://..."
 * layers: []
 *   </script>
 * </ml-map>
 * ```
 *
 * ### 3. JSON Attribute
 * ```html
 * <ml-map config='{"type":"map",...}'></ml-map>
 * ```
 *
 * ## Manual Registration
 *
 * If you need more control over registration:
 *
 * ```javascript
 * import { MLMap, registerMLMap } from '@maplibre-yaml/core/components';
 *
 * // Register with default name
 * registerMLMap();
 *
 * // Or register with custom name
 * customElements.define('my-map', MLMap);
 * ```
 */

export { MLMap, registerMLMap } from "./ml-map.js";
export { defaultStyles, injectStyles } from "./styles";

// Auto-inject styles when module is imported
import "./styles";
