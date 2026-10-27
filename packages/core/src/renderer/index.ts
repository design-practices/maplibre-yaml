/**
 * @file Renderer module exports
 * @module @maplibre-yaml/core/renderer
 */

export { MapRenderer } from "./map-renderer";
export type { MapRendererOptions, MapRendererEvents, ChromeMount, MapErrorContext } from "./map-renderer";
// Live documents (0.10): what `MapRenderer.update()` takes and resolves.
export type {
  AppliedDocument,
  DiffHints,
  DocumentOptions,
  RejectionKind,
  UpdateResult,
  UpdateSummary,
} from "./update/types";

export { LayerManager } from "./layer-manager";
export type { LayerManagerCallbacks } from "./layer-manager";

export { EventHandler } from "./event-handler";
export type { EventHandlerCallbacks } from "./event-handler";

export { MarkersManager } from "./markers-manager";
export { loadDocumentImages } from "./images-loader";
export type { MarkersManagerCallbacks } from "./markers-manager";

export { ParamsBuilder, hasPanelContent } from "./params-builder";
export type {
  ParamsPanelConfig,
  ParamsPanelCallbacks,
  ParameterMeta,
  ToggleableLayer,
} from "./params-builder";

export { ChromeLayout, CHROME_CORNERS } from "./chrome-layout";
export type { ChromeCorner } from "./chrome-layout";

export { PopupBuilder } from "./popup-builder";
export { LegendBuilder } from "./legend-builder";
export { ControlsManager } from "./controls-manager";
