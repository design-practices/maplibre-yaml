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
export { projectStyle, EmitError } from "./emitter";
export type { EmitMode, EmitWarning, EmitResult } from "./emitter";

// Utils
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
