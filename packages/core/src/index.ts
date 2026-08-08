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

// Internal model — the shape the renderer and the emitter share
export * from "./model";

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
export { escapeHtml, safeUrl, POPUP_TAGS, LINK_TARGETS } from "./utils/html";
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
