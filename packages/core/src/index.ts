/**
 * @maplibre-yaml/core
 *
 * Declarative web maps with YAML configuration.
 *
 * @packageDocumentation
 */

// Schemas
export * from "./schemas";

// Parser
export * from "./parser";

// Renderer
export * from "./renderer";

// Data
export * from "./data";

// UI
export * from "./ui";

// The v2 internal model — public because it is the emitter's input type
// (`projectStyle(model)`), so ejecting requires it. Named rather than
// `export *`, so widening the surface is a deliberate edit, not a side effect
// of adding a file under model/.
export {
  normalizeMapBlock,
  toModel,
  normalizeLayer,
  normalizeSource,
  denormalizeConfig,
  denormalizeLayers,
  denormalizeSources,
  denormalizeOptions,
  SOURCE_RUNTIME_KEYS,
  LAYER_RUNTIME_KEYS,
} from "./model";
export type {
  MapModel,
  StyleHalf,
  RuntimeHalf,
  CameraModel,
  LayerModel,
  SourceModel,
  V1MapInput,
} from "./model";

// Extension registry — validated, normalized `x-*` blocks
export { ExtensionRegistry } from "./extensions";
export type {
  ExtensionDefinition,
  ExtensionBlock,
  ExtensionWarning,
  ExtractResult,
} from "./extensions";

// Emitter — projects the model's style half to spec-valid style.json
export { projectStyle, EmitError, mergeBasemap, resolveBasemap, applyRuntimeGate } from "./emitter";
export type {
  EmitMode,
  EmitWarning,
  EmitWarningKind,
  EmitResult,
  LayerPlacement,
  BasemapFetcher,
} from "./emitter";

// Capability policy — what a document may do, given where it is compiled
export {
  STATE_RUNTIME_FLOOR,
  DEFAULT_POLICY,
  meetsVersion,
  supportsState,
  allowsHtml,
  allowsOrigin,
} from "./capabilities";
export type { CapabilityPolicy, TrustContext } from "./capabilities";

// Utils
export { escapeHtml, safeUrl, POPUP_TAGS, LINK_TARGETS, html, isHtmlMarker } from "./utils/html";
export type { HtmlMarker } from "./utils/html";
export { EventEmitter } from "./utils/event-emitter";
export type { EventHandler } from "./utils/event-emitter";
export {
  resolveMapConfig,
  resolveMapBlock,
  isMapConfigComplete,
  createSimpleMapConfig,
  ConfigResolutionError,
} from "./utils/config-resolver";

// Note: Components are exported separately via './components' entry point
// to avoid auto-registering custom elements when not needed
