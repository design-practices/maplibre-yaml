/**
 * Web Components for maplibre-yaml.
 *
 * Import this module to register custom elements:
 * - <ml-map> - Map container component
 *
 * Styles are automatically injected when this module is imported.
 *
 * @module @maplibre-yaml/core/components
 *
 * @example
 * ```typescript
 * // Import to register components and inject styles
 * import '@maplibre-yaml/core/components';
 *
 * // Or import specific components
 * import { MLMap } from '@maplibre-yaml/core/components';
 * ```
 */

export { MLMap } from "./ml-map";
export { defaultStyles, injectStyles } from "./styles";

// Auto-inject styles when module is imported
import "./styles";
